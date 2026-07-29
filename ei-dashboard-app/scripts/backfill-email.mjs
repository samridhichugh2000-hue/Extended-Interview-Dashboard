// One-off: backfill employees.email for the current roster without
// re-running sync-koenig.mjs, which would wipe every other synced column
// (NR, utilization, exams, audits, SCs, PIP/PA...) back to null. Safe to
// re-run any time — it only ever UPDATEs the email column.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getNewJoiners } = await import('../lib/koenigApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function sixMonthsAgo() {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

const raw = await getNewJoiners(sixMonthsAgo(), today());
let updated = 0;
for (const nj of raw) {
  if (!nj.empId || !nj.email) continue;
  const id = 'EMP' + Math.trunc(Number(nj.empId));
  const res = await db.execute({ sql: 'UPDATE employees SET email = ? WHERE id = ?', args: [nj.email, id] });
  if (res.rowsAffected) updated++;
}

console.log(`Backfilled email for ${updated} employees.`);
