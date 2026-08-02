// Syncs Shoddy incident data from the Koenig "Get Incident Data By EmpID"
// API into employees.shoddy_neg_count/shoddy_neg_details/shoddy_pos_count/
// shoddy_pos_details, across all three teams. Per-employee API — one call
// per employee, matched directly by EmpCode.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getShoddyRecords } = await import('../lib/koenigShoddyApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1");

let updated = 0;
let unmatched = 0;
for (const emp of allEmployees.rows) {
  const empCode = emp.id.replace('EMP', '');
  const { negative, positive } = await getShoddyRecords(empCode);

  await db.execute({
    sql: 'UPDATE employees SET shoddy_neg_count = ?, shoddy_neg_details = ?, shoddy_pos_count = ?, shoddy_pos_details = ? WHERE id = ?',
    args: [negative.length, JSON.stringify(negative), positive.length, JSON.stringify(positive), emp.id],
  });
  if (negative.length || positive.length) updated++; else unmatched++;
}

console.log(`Synced Shoddy data for full roster — ${updated} employees have at least one record (${unmatched} have none).`);
const check = await db.execute("SELECT id, name, shoddy_neg_count, shoddy_pos_count FROM employees WHERE shoddy_neg_count > 0 OR shoddy_pos_count > 0 ORDER BY shoddy_neg_count DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, 'neg:', r.shoddy_neg_count, 'pos:', r.shoddy_pos_count);
