import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';
import { getUnrepliedThreads, UNREPLIED_LOOKBACK_DAYS, UNREPLIED_GRACE_HOURS } from '../../../../lib/graphUnreplied';
import { loadUnreplied, saveUnreplied } from '../../../../lib/unrepliedStore';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // live mode reads each candidate mail and has it classified

// GET /api/outlook/unreplied?employeeId=EMP123[&live=1]
// Default: the list saved by the nightly sync (instant). `live=1` re-reads the
// mailbox from Outlook now (slow on big inboxes) and refreshes the saved copy.
// Takes an employee id, never a raw address, so it can only open the mailbox
// of an active employee on the roster. Behind the dashboard's Basic Auth gate.
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const employeeId = params.get('employeeId');
  const live = params.get('live') === '1';
  if (!employeeId) return NextResponse.json({ ok: false, error: '`employeeId` query param is required.' }, { status: 400 });

  const db = getDb();
  const res = await db.execute({ sql: 'SELECT id, name, email, unreplied_synced_at FROM employees WHERE id = ? AND active = 1', args: [employeeId] });
  const emp = res.rows[0];
  if (!emp?.email) return NextResponse.json({ ok: false, error: 'No active employee with an email on file for that id.' }, { status: 404 });

  const base = { ok: true, employeeId: emp.id, name: emp.name, lookbackDays: UNREPLIED_LOOKBACK_DAYS, graceHours: UNREPLIED_GRACE_HOURS };
  try {
    const saved = live ? null : await loadUnreplied(emp.id);
    if (saved) {
      return NextResponse.json({ ...base, source: 'saved', syncedAt: emp.unreplied_synced_at, unrepliedCount: saved.unreplied.length, unreplied: saved.unreplied, notNeeded: saved.notNeeded });
    }
    const { threadsConsidered, eligibleMessages, unreplied, notNeeded } = await getUnrepliedThreads(emp.email);
    const syncedAt = new Date().toISOString();
    await saveUnreplied(emp.id, unreplied, notNeeded);
    await db.execute({
      sql: 'UPDATE employees SET unreplied_email_count = ?, unreplied_email_total = ?, unreplied_synced_at = ? WHERE id = ?',
      args: [unreplied.length, threadsConsidered, syncedAt, emp.id],
    });
    return NextResponse.json({ ...base, source: 'live', syncedAt, threadsConsidered, eligibleMessages, unrepliedCount: unreplied.length, unreplied, notNeeded });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status || 500 });
  }
}
