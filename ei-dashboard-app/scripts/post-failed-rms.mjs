// Posts dashboard-issued PA/PIPs to RMS whose first post failed (pip_status.rms_status='failed'), same logic as
// app/api/employees/[id]/rms-retry/route.js. Production's Koenig "Insert PiP Records" login is refused (GetToken
// 'Forbidden: Permission denied', first seen 2026-11-15), so this runs on this machine every 10 minutes from the
// "EI RMS Post Failed PA-PIPs" Windows task (and once per full sync). Silent and read-only when nothing is pending.
import { fileURLToPath } from 'url'; import path from 'path'; import { config } from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });
const { getDb } = await import('../lib/db.js');
const { displayDateToIso } = await import('../lib/analysis.js');
const { buildInsertPipRequest, insertPipRecord } = await import('../lib/koenigPipInsertApi.js');
const db = getDb();
const rows = (await db.execute(`SELECT id, employee_id, type, issued_on, review_by, comment FROM pip_status WHERE source_id IS NULL AND rms_status = 'failed' ORDER BY id`)).rows;
if (rows.length) console.log(`${new Date().toISOString()} ${rows.length} failed row(s) to post`);
for (const row of rows) {
  const issuedOn = displayDateToIso(row.issued_on), deadline = displayDateToIso(row.review_by);
  if (!issuedOn || !deadline) { console.log(row.employee_id, 'unreadable dates', row.issued_on, row.review_by); continue; }
  let ok = false, err = null;
  try { const r = await insertPipRecord(buildInsertPipRequest({ employeeId: row.employee_id, pipType: row.type, issuedOn, deadline, comment: row.comment })); ok = true; console.log(row.employee_id, row.type, 'issued', row.issued_on, 'review', row.review_by, '-> posted', JSON.stringify(r).slice(0, 160)); }
  catch (e) { err = e.message; console.log(row.employee_id, 'FAILED', err); }
  await db.execute({ sql: 'UPDATE pip_status SET rms_status = ?, rms_error = ?, rms_posted_at = ? WHERE id = ?', args: [ok ? 'posted' : 'failed', ok ? null : String(err).slice(0, 500), new Date().toISOString(), row.id] });
}
await new Promise((r) => setTimeout(r, 500)); process.exit(0);
