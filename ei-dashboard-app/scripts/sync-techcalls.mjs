// Syncs Tech Call data from the Koenig "Get Tech Call Data for CSM" API into
// employees.tech_calls_count/tech_calls_details, Sales team only. Matched by
// EmpId *and* name (CSMName) together — see lib/koenigTechCallApi.js. A
// confirmed "no matching record" from Koenig is a real 0, not a reason to
// leave the field null forever, same convention as the other feeds.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getTechCalls } = await import('../lib/koenigTechCallApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const salesEmployees = await db.execute("SELECT id, name FROM employees WHERE team = 'Sales'");

let updated = 0;
let unmatched = 0;
for (const emp of salesEmployees.rows) {
  const empCode = emp.id.replace('EMP', '');
  const result = await getTechCalls(empCode, emp.name);

  await db.execute({
    sql: 'UPDATE employees SET tech_calls_count = ?, tech_calls_details = ? WHERE id = ?',
    args: [result ? result.techCalls : 0, JSON.stringify(result ? [result.raw] : []), emp.id],
  });
  if (result) updated++; else unmatched++;
}

console.log(`Synced tech call data for Sales roster — ${updated} employees have at least one record (${unmatched} have none).`);
const check = await db.execute("SELECT id, name, tech_calls_count FROM employees WHERE team = 'Sales' AND tech_calls_count > 0 ORDER BY tech_calls_count DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.tech_calls_count);
