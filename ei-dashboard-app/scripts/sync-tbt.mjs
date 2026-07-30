// Syncs TBTs (Train-the-Trainer sessions) from the Koenig "Get TBT RECORD"
// API into employees.tbt_count/tbt_details, Trainer team only. Per-employee
// API like exam summary/skills — one call per Trainer, matched directly by
// EmpCode.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getTbtRecords } = await import('../lib/koenigTbtApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const trainerEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Trainer'");

let updated = 0;
let unmatched = 0;
for (const emp of trainerEmployees.rows) {
  const empCode = emp.id.replace('EMP', '');
  const records = await getTbtRecords(empCode);

  await db.execute({
    sql: 'UPDATE employees SET tbt_count = ?, tbt_details = ? WHERE id = ?',
    args: [records.length, JSON.stringify(records), emp.id],
  });
  if (records.length) updated++; else unmatched++;
}

console.log(`Synced TBT data for Trainer roster — ${updated} employees have at least one TBT (${unmatched} have none).`);
const check = await db.execute("SELECT id, name, tbt_count FROM employees WHERE team = 'Trainer' AND tbt_count > 0 ORDER BY tbt_count DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.tbt_count);
