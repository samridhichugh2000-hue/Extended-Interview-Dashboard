import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';
import { getUnrepliedThreads, UNREPLIED_LOOKBACK_DAYS, UNREPLIED_GRACE_HOURS } from '../../../../lib/graphUnreplied';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/outlook/unreplied?employeeId=EMP123
// Live read of that employee's unreplied threads, triggered by "Load emails"
// on the Graph Calls → Unreplied Emails screen. Nothing is stored. Takes an
// employee id, never a raw address, so it can only open the mailbox of an
// active employee on the roster. Behind the dashboard's Basic Auth gate.
export async function GET(request) {
  const employeeId = new URL(request.url).searchParams.get('employeeId');
  if (!employeeId) return NextResponse.json({ ok: false, error: '`employeeId` query param is required.' }, { status: 400 });

  const db = getDb();
  const res = await db.execute({ sql: 'SELECT id, name, email FROM employees WHERE id = ? AND active = 1', args: [employeeId] });
  const emp = res.rows[0];
  if (!emp?.email) return NextResponse.json({ ok: false, error: 'No active employee with an email on file for that id.' }, { status: 404 });

  try {
    const { threadsConsidered, eligibleMessages, unreplied } = await getUnrepliedThreads(emp.email);
    return NextResponse.json({
      ok: true, employeeId: emp.id, name: emp.name,
      lookbackDays: UNREPLIED_LOOKBACK_DAYS, graceHours: UNREPLIED_GRACE_HOURS,
      threadsConsidered, eligibleMessages, unrepliedCount: unreplied.length, unreplied,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status || 500 });
  }
}
