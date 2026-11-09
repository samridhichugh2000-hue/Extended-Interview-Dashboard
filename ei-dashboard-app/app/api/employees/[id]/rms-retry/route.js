import { NextResponse } from 'next/server';
import { getDb } from '../../../../../lib/db';
import { displayDateToIso } from '../../../../../lib/analysis';
import { buildInsertPipRequest, insertPipRecord } from '../../../../../lib/koenigPipInsertApi';

export const dynamic = 'force-dynamic';

// Re-posts a dashboard-issued PA/PIP to RMS after the first post failed (pip_status.rms_status = 'failed',
// set by the alert route). Only a row still marked 'failed' is ever re-sent, so a record RMS already has
// can't be posted twice from here; the row flips to 'posted' on success.
export async function POST(_request, { params }) {
  const { id } = params;
  const db = getDb();
  const found = await db.execute({
    sql: `SELECT id, type, issued_on, review_by, comment FROM pip_status
          WHERE employee_id = ? AND source_id IS NULL AND rms_status = 'failed' ORDER BY id DESC LIMIT 1`,
    args: [id],
  });
  const row = found.rows[0];
  if (!row) return NextResponse.json({ ok: false, error: 'No failed RMS post found for this employee.' }, { status: 404 });
  const issuedOn = displayDateToIso(row.issued_on);
  const deadline = displayDateToIso(row.review_by);
  if (!issuedOn || !deadline) return NextResponse.json({ ok: false, error: 'Stored issue/review dates are not in a readable format.' }, { status: 422 });

  let outcome;
  try {
    await insertPipRecord(buildInsertPipRequest({ employeeId: id, pipType: row.type, issuedOn, deadline, comment: row.comment }));
    outcome = { ok: true };
  } catch (err) {
    console.error(`rms-retry(${id}) failed:`, err.message);
    outcome = { ok: false, error: err.message };
  }
  await db.execute({
    sql: 'UPDATE pip_status SET rms_status = ?, rms_error = ?, rms_posted_at = ? WHERE id = ?',
    args: [outcome.ok ? 'posted' : 'failed', outcome.ok ? null : String(outcome.error).slice(0, 500), new Date().toISOString(), row.id],
  });
  return NextResponse.json({ ok: outcome.ok, error: outcome.error });
}
