import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function confirmationEmailHtml({ name, week, q1, a1, q2, a2, q3, a3, attachmentName }) {
  return `
    <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">
      <p>Hi ${name},</p>
      <p>Thanks — your check-in for ${week} has been recorded:</p>
      <p><b>${q1}</b><br/>${a1}</p>
      <p><b>${q2}</b><br/>${a2}</p>
      ${q3 ? `<p><b>${q3}</b><br/>${a3}${attachmentName ? ` - experiment sheet attached (${attachmentName})` : ''}</p>` : ''}
    </div>`;
}

// An uncaught error here (e.g. the database refusing writes) used to come back
// as an empty 500, which the form then failed to parse as JSON. Always answer
// with JSON so the NJ sees a real message and can retry.
export async function POST(request, ctx) {
  try {
    return await handlePost(request, ctx);
  } catch (err) {
    console.error('Weekly response submit failed:', err.message);
    return NextResponse.json(
      { ok: false, error: 'We could not save your response just now. Nothing was lost on your side — please try again in a few minutes.' },
      { status: 503 },
    );
  }
}

async function handlePost(request, { params }) {
  const { token } = params;
  const body = await request.json().catch(() => null);
  const a1 = body?.a1?.trim();
  const a2 = body?.a2?.trim();
  if (!a1 || !a2) {
    return NextResponse.json({ ok: false, error: 'Both answers are required.' }, { status: 400 });
  }
  const a3 = body?.a3 === 'Yes' || body?.a3 === 'No' ? body.a3 : null;
  // The experiment sheet is only emailed, never stored: validate it, keep its name, drop the bytes after sending.
  let attachment = null;
  const att = body?.attachment;
  if (a3 === 'Yes' && att?.content) {
    const name = String(att.name || 'experiment-sheet').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const size = Math.floor((String(att.content).length * 3) / 4);
    if (!/\.(xlsx|xlsm|xls|csv|pdf|docx|doc|pptx|png|jpe?g)$/i.test(name)) return NextResponse.json({ ok: false, error: 'That file type is not accepted.' }, { status: 400 });
    if (size > 3 * 1024 * 1024) return NextResponse.json({ ok: false, error: 'The attachment is over 3 MB.' }, { status: 400 });
    attachment = { name, contentType: String(att.type || 'application/octet-stream'), content: String(att.content) };
  }

  const db = getDb();
  const existing = await db.execute({
    sql: `SELECT wr.*, e.name, e.email, e.manager FROM weekly_responses wr
          JOIN employees e ON e.id = wr.employee_id
          WHERE wr.token = ?`,
    args: [token],
  });
  const row = existing.rows[0];
  if (!row) {
    return NextResponse.json({ ok: false, error: 'Link not found.' }, { status: 404 });
  }
  if (row.state === 'Received') {
    return NextResponse.json({ ok: false, error: 'This response has already been submitted.' }, { status: 409 });
  }
  if (row.q3 && !a3) {
    return NextResponse.json({ ok: false, error: 'Please answer the experiment-sheet question.' }, { status: 400 });
  }

  await db.execute({
    sql: `UPDATE weekly_responses SET a1 = ?, a2 = ?, a3 = ?, attachment_name = ?, received_at = ?, state = 'Received' WHERE token = ?`,
    args: [a1, a2, row.q3 ? a3 : null, attachment?.name || null, new Date().toISOString(), token],
  });

  // Rate immediately so the dashboard (a plain live DB query, no caching)
  // reflects it as soon as this request completes, instead of waiting on
  // the manual list-unrated-responses.mjs/save-ratings.mjs pass. A rating
  // failure (rate limit, timeout, malformed reply) shouldn't lose the NJ's
  // already-recorded answer — log and leave ai_rating NULL for that backfill
  // path to pick up later, same resilience pattern as the email send below.
  try {
    const { rateWeeklyResponse } = await import('../../../../lib/rateWeeklyResponse');
    const prior = await db.execute({
      sql: `SELECT a1, a2 FROM weekly_responses WHERE employee_id = ? AND state = 'Received' AND week < ? ORDER BY week DESC LIMIT 1`,
      args: [row.employee_id, row.week],
    });
    const { rating, reason } = await rateWeeklyResponse({
      q1: row.q1, a1, q2: row.q2, a2,
      priorA1: prior.rows[0]?.a1 || null,
      priorA2: prior.rows[0]?.a2 || null,
    });
    await db.execute({
      sql: `UPDATE weekly_responses SET ai_rating = ?, ai_rating_reason = ? WHERE token = ?`,
      args: [String(rating), reason, token],
    });
  } catch (err) {
    console.error('Weekly response AI rating failed:', err.message);
  }

  // A Graph hiccup here shouldn't lose an already-recorded answer — log and
  // still report success to the NJ.
  if (row.email) {
    try {
      const { sendMail } = await import('../../../../lib/graphMailer');
      const { getManagerEmail } = await import('../../../../lib/managerDirectory');
      await sendMail({
        to: row.email,
        cc: getManagerEmail(row.manager),
        subject: `Your response has been recorded — ${row.week}`,
        html: confirmationEmailHtml({ name: row.name, week: row.week, q1: row.q1, a1, q2: row.q2, a2, q3: row.q3, a3, attachmentName: attachment?.name }),
        ...(attachment ? { attachments: [attachment] } : {}),
      });
    } catch (err) {
      console.error('Weekly response confirmation email failed:', err.message);
    }
  }

  return NextResponse.json({ ok: true });
}
