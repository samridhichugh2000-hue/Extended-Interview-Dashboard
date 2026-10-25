import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';
import { VIDEO_MIN_ATTEND_SECONDS, videoWindowStart, videoMeetingQualifies } from '../../../lib/videoRules';

export const dynamic = 'force-dynamic';

// Meeting-by-meeting camera on/off for one employee (the dashboard's popup).
// Behind the same password gate as the rest of the dashboard (middleware.js).
export async function GET(request) {
  const employeeId = request.nextUrl.searchParams.get('employeeId');
  if (!employeeId) return NextResponse.json({ error: 'employeeId required' }, { status: 400 });
  const db = getDb();
  const emp = await db.execute({ sql: 'SELECT team FROM employees WHERE id = ?', args: [employeeId] });
  const team = emp.rows[0]?.team;
  const res = await db.execute({
    sql: `SELECT v.started_at, v.attended_seconds, v.camera_on, v.is_external, v.participant_count, i.subject, i.organizer_name, i.participants
          FROM video_meetings v LEFT JOIN video_meeting_info i ON i.call_record_id = v.call_record_id
          WHERE v.employee_id = ? AND v.started_at >= ? AND v.attended_seconds >= ? ORDER BY v.started_at DESC`,
    args: [employeeId, videoWindowStart(), VIDEO_MIN_ATTEND_SECONDS],
  }).catch(() => ({ rows: [] }));
  const meetings = res.rows
    .filter((r) => videoMeetingQualifies(team, r.is_external))
    .map((r) => ({ startedAt: r.started_at, minutes: Math.round(Number(r.attended_seconds) / 60), cameraOn: !!r.camera_on, external: !!r.is_external, participantCount: r.participant_count, title: r.subject || null, organizer: r.organizer_name || null, attendees: r.participants ? JSON.parse(r.participants) : [] }));
  return NextResponse.json({ team, meetings });
}
