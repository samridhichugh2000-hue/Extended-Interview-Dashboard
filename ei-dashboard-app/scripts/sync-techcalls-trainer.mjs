// Syncs converted tech-call counts from the Koenig "Get Tech calls converted
// count Value" API into employees.tech_calls_converted, Trainer team only.
// Matched by email (no employee code on this feed) — requires
// employees.email to already be populated (see backfill-email.mjs).
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getConvertedTechCalls } = await import('../lib/koenigTechCallConvertedApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const trainerEmployees = await db.execute("SELECT id, email FROM employees WHERE team = 'Trainer'");

let updated = 0;
let noEmail = 0;
let unmatched = 0;
for (const emp of trainerEmployees.rows) {
  if (!emp.email) { noEmail++; continue; }
  const result = await getConvertedTechCalls(emp.email);
  if (!result) { unmatched++; continue; }

  await db.execute({ sql: 'UPDATE employees SET tech_calls_converted = ? WHERE id = ?', args: [result.converted, emp.id] });
  updated++;
}

console.log(`Synced converted tech calls for ${updated} Trainer employees (${unmatched} had no record, ${noEmail} had no email on file).`);
const check = await db.execute("SELECT id, name, tech_calls_converted FROM employees WHERE team = 'Trainer' AND tech_calls_converted > 0 ORDER BY tech_calls_converted DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.tech_calls_converted);
