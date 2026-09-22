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

// Bounded concurrency — see scripts/sync-exam.mjs for why. This feed in
// particular is the slowest of the Trainer syncs (~1s/call via email
// lookup), so it needs this the most.
const CONCURRENCY = 20;
async function mapWithConcurrency(items, limit, fn) {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

let updated = 0;
let noEmail = 0;
let unmatched = 0;
await mapWithConcurrency(trainerEmployees.rows, CONCURRENCY, async (emp) => {
  if (!emp.email) { noEmail++; return; }
  const result = await getConvertedTechCalls(emp.email);
  // Same treatment as the Sales tech-calls feed: "no matching record" from
  // Koenig is a confirmed 0, not a reason to leave the field null forever.
  // Only a missing email (can't even query) stays null/no-data.
  const converted = result ? result.converted : 0;
  if (!result) unmatched++;

  await db.execute({ sql: 'UPDATE employees SET tech_calls_converted = ? WHERE id = ?', args: [converted, emp.id] });
  updated++;
});

console.log(`Synced converted tech calls for ${updated} Trainer employees (${unmatched} of those had no matching record and were set to 0, ${noEmail} had no email on file and were left untouched).`);
const check = await db.execute("SELECT id, name, tech_calls_converted FROM employees WHERE team = 'Trainer' AND tech_calls_converted > 0 ORDER BY tech_calls_converted DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.tech_calls_converted);
