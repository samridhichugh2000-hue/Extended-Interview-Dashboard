// Syncs Tech Call data from the Koenig "Get Tech Call Data for CSM" API into
// employees.tech_calls_count/tech_calls_details, Sales team only. Per-
// employee API matched directly by EmpId (Koenig employee code). No live
// sample record was available while building this (every probe returned
// the API's own "no matching record" placeholder), so rows are stored raw
// rather than mapped to named fields — see lib/koenigTechCallApi.js.
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

const salesEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Sales'");

let updated = 0;
let unmatched = 0;
for (const emp of salesEmployees.rows) {
  const empCode = emp.id.replace('EMP', '');
  const calls = await getTechCalls(empCode);

  await db.execute({
    sql: 'UPDATE employees SET tech_calls_count = ?, tech_calls_details = ? WHERE id = ?',
    args: [calls.length, JSON.stringify(calls), emp.id],
  });
  if (calls.length) updated++; else unmatched++;
}

console.log(`Synced tech call data for Sales roster — ${updated} employees have at least one record (${unmatched} have none).`);
const check = await db.execute("SELECT id, name, tech_calls_count FROM employees WHERE team = 'Sales' AND tech_calls_count > 0 ORDER BY tech_calls_count DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.tech_calls_count);
