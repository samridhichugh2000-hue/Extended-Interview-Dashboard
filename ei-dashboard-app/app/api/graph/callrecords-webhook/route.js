import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';
import { getCallRecord, resolveUserEmailById } from '../../../../lib/graphCallsApi';
import { recomputeGraphAggregates } from '../../../../lib/syncRunners';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Rule-of-thumb Teams-call quality thresholds — there's no single documented
// "good/bad" cutoff from Microsoft for these, so treat this as a starting
// point to calibrate once real payloads have been seen (>5% packet loss or
// >30ms jitter is generally audible/visible degradation; >400ms round trip
// is noticeably laggy).
const PACKET_LOSS_THRESHOLD = 0.05;
const JITTER_THRESHOLD_MS = 30;
const RTT_THRESHOLD_MS = 400;

// A call record's window-metric fields can be Duration ("PT0.024S") or a
// plain number of seconds depending on Graph API version — handle both.
function toSeconds(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(v));
  if (!m) return null;
  const [, h, min, s] = m;
  return (Number(h) || 0) * 3600 + (Number(min) || 0) * 60 + (Number(s) || 0);
}

// Field names below match Microsoft Graph's documented callRecord/session/
// segment/media schema as of this writing — verify against a real payload
// once notifications start arriving (Graph's beta/v1.0 naming for these
// media-quality metrics has shifted before) and adjust here if they differ.
function collectStreamProblems(sessions, mediaType) {
  const problems = [];
  for (const session of sessions || []) {
    for (const segment of session.segments || []) {
      for (const media of segment.media || []) {
        if (media.mediaType !== mediaType) continue;
        const streams = media.streams?.length ? media.streams : [media];
        for (const stream of streams) {
          const packetLoss = stream.averagePacketLossRate ?? stream.packetLossRateAvg ?? 0;
          const jitterMs = (toSeconds(stream.averageJitter ?? stream.jitterAvg) ?? 0) * 1000;
          const rttMs = (toSeconds(stream.averageRoundTripTime ?? stream.roundTripTimeAvg) ?? 0) * 1000;
          if (packetLoss > PACKET_LOSS_THRESHOLD || jitterMs > JITTER_THRESHOLD_MS || rttMs > RTT_THRESHOLD_MS) {
            problems.push({ segmentId: segment.id, startDateTime: segment.startDateTime, packetLoss, jitterMs: Math.round(jitterMs), rttMs: Math.round(rttMs) });
          }
        }
      }
    }
  }
  return problems;
}

async function processNotification(db, item) {
  if (item.clientState !== process.env.GRAPH_WEBHOOK_CLIENT_STATE) {
    console.error('Graph callRecords webhook: clientState mismatch, dropping notification', item.subscriptionId);
    return;
  }

  const callRecordId = item.resourceData?.id;
  if (!callRecordId) return;

  // Already have this one (Graph can redeliver) — skip re-fetching/re-matching.
  const existing = await db.execute({ sql: 'SELECT id FROM graph_call_records WHERE id = ?', args: [callRecordId] });
  if (existing.rows.length) return;

  const record = await getCallRecord(callRecordId);
  const organizerAadId = record.organizer?.user?.id;
  const organizerEmail = organizerAadId ? await resolveUserEmailById(organizerAadId) : null;

  const audioProblems = collectStreamProblems(record.sessions, 'audio');
  const videoProblems = collectStreamProblems(record.sessions, 'video');
  const hasAudioIssue = audioProblems.length > 0;
  const hasVideoIssue = videoProblems.length > 0;
  const avIssue = hasAudioIssue || hasVideoIssue ? 1 : 0;
  const qualitySummary = JSON.stringify({ audioProblems, videoProblems });

  let matched = 0;
  if (organizerEmail) {
    // Same organizer, same meeting instance (±30 min of the call record's
    // own start time) — covers every Sales rep who attended this meeting in
    // one statement, not just one row.
    const result = await db.execute({
      sql: `UPDATE graph_meetings SET call_record_id = ?, av_issue = ?, av_issue_details = ?
            WHERE organizer_email = ? AND call_record_id IS NULL
              AND ABS(strftime('%s', scheduled_start) - strftime('%s', ?)) < 1800`,
      args: [callRecordId, avIssue, qualitySummary, organizerEmail, record.startDateTime],
    });
    matched = Number(result.rowsAffected || 0) > 0 ? 1 : 0;
  }

  await db.execute({
    sql: `INSERT INTO graph_call_records (id, organizer_email, start_datetime, end_datetime, has_audio_issue, has_video_issue, quality_summary, matched, received_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [callRecordId, organizerEmail, record.startDateTime, record.endDateTime, hasAudioIssue ? 1 : 0, hasVideoIssue ? 1 : 0, qualitySummary, matched, new Date().toISOString()],
  });

  if (matched) {
    const affected = await db.execute({ sql: 'SELECT DISTINCT employee_id FROM graph_meetings WHERE call_record_id = ?', args: [callRecordId] });
    for (const row of affected.rows) await recomputeGraphAggregates(db, row.employee_id);
  }
}

export async function POST(request) {
  // Subscription-creation handshake: Graph POSTs here with the token in the
  // query string and expects it echoed back as plain text within 10s, no
  // body parsing or auth check involved.
  const validationToken = request.nextUrl.searchParams.get('validationToken');
  if (validationToken !== null) {
    return new NextResponse(validationToken, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  const db = getDb();
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  for (const item of body.value || []) {
    try {
      await processNotification(db, item);
    } catch (err) {
      // One bad notification shouldn't fail the whole batch — Graph will
      // retry the batch on a non-2xx, so log and keep going instead.
      console.error('Graph callRecords webhook: failed to process notification', item.resourceData?.id, err.message);
    }
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
