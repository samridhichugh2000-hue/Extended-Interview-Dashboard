// Syncs KGT (ownership-transfer request) participation from the standalone
// Polls Dashboard API into employees.kgt_count/kgt_details, across all three
// teams. Matched by employee code — a 404 from the API means it has no
// employee record for that code at all (left untouched/null), distinct from
// a genuine 0, which comes back as a normal 200 and is written as-is.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getKgtParticipation } = await import('../lib/kgtApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1");

let updated = 0;
let unmatched = 0;
for (const emp of allEmployees.rows) {
  const empCode = emp.id.replace('EMP', '');
  const result = await getKgtParticipation(empCode);
  if (!result) { unmatched++; continue; }

  await db.execute({
    sql: 'UPDATE employees SET kgt_count = ?, kgt_details = ? WHERE id = ?',
    args: [result.count, JSON.stringify(result.kgts), emp.id],
  });
  updated++;
}

console.log(`Synced KGT participation for ${updated} employees (${unmatched} had no record on the polls dashboard).`);
const check = await db.execute('SELECT id, name, team, kgt_count FROM employees WHERE kgt_count > 0 ORDER BY kgt_count DESC');
for (const r of check.rows) console.log(' ', r.id, r.name, r.team, r.kgt_count);
