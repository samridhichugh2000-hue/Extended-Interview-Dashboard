// Syncs poll participation counts from the standalone Polls Dashboard API
// into employees.polls_participated, across all three teams. Matched by
// email — requires employees.email to already be populated (see
// backfill-email.mjs). A 404 from the API means it has no record for that
// email at all (left untouched/null) — distinct from a genuine 0, which
// comes back as a normal 200 and is written as-is.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getPollsParticipation } = await import('../lib/pollsApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const allEmployees = await db.execute("SELECT id, email FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1");

let updated = 0;
let noEmail = 0;
let unmatched = 0;
for (const emp of allEmployees.rows) {
  if (!emp.email) { noEmail++; continue; }
  const result = await getPollsParticipation(emp.email);
  if (!result) { unmatched++; continue; }

  await db.execute({ sql: 'UPDATE employees SET polls_participated = ? WHERE id = ?', args: [result.participated, emp.id] });
  updated++;
}

console.log(`Synced poll participation for ${updated} employees (${unmatched} had no record on the polls dashboard, ${noEmail} had no email on file).`);
const check = await db.execute('SELECT id, name, team, polls_participated FROM employees WHERE polls_participated > 0 ORDER BY polls_participated DESC');
for (const r of check.rows) console.log(' ', r.id, r.name, r.team, r.polls_participated);
