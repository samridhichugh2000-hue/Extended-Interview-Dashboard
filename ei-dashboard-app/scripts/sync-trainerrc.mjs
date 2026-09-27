// Syncs distinct "Main Trainer" assignments from the Koenig Trainer RC
// (Resource Chart) Schedule feed into employees.rc_main_assignments_count/
// rc_main_assignments_details, Trainer team only. Unlike sync-assignments.mjs
// (the plain Trainer Assignment feed), this feed's TrainerRole field tells a
// lead trainer apart from a co/backup trainer on the same batch — feeds the
// PA Algo's "zero assignments as main trainer" check only (lib/paAlgo.js),
// not a replacement for assignments_count/assignments_details, which several
// other screens/signals still read.
//
// Per-employee API (no bulk mode), like sync-util.mjs. Same recycled-emp-
// code/2-year lookback guard as sync-assignments.mjs, and stops at today
// rather than reaching into the future — a scheduled-but-undelivered batch
// shouldn't count as "has delivered a main assignment" yet.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getTrainerRcSchedule, distinctMainTrainerAssignments } = await import('../lib/koenigTrainerRcApi.js');
const { istDateKey } = await import('../lib/weekUtils.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const RC_LOOKBACK_DAYS = 730;
function sinceDate(tenureDays) {
  const joined = new Date();
  joined.setDate(joined.getDate() - tenureDays);
  joined.setHours(0, 0, 0, 0);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RC_LOOKBACK_DAYS);
  cutoff.setHours(0, 0, 0, 0);
  return joined > cutoff ? joined : cutoff;
}

const trainerEmployees = await db.execute("SELECT id, email, tenure_days FROM employees WHERE team = 'Trainer' AND active = 1");
const today = istDateKey(new Date());

let updated = 0;
let unmatched = 0;
let skippedNoEmail = 0;
let apiErrors = 0;
for (const emp of trainerEmployees.rows) {
  if (!emp.email) { skippedNoEmail++; continue; }
  try {
    const since = sinceDate(emp.tenure_days);
    const rows = await getTrainerRcSchedule(emp.email, istDateKey(since), today);
    const assignments = distinctMainTrainerAssignments(rows);
    await db.execute({
      sql: 'UPDATE employees SET rc_main_assignments_count = ?, rc_main_assignments_details = ? WHERE id = ?',
      args: [assignments.length, JSON.stringify(assignments), emp.id],
    });
    if (assignments.length) updated++; else unmatched++;
  } catch (err) {
    console.error(`Trainer RC sync failed for ${emp.id}:`, err.message);
    apiErrors++;
  }
}

console.log(`Synced Main Trainer assignments for ${updated} Trainer employees (${unmatched} have none, ${skippedNoEmail} no email on file, ${apiErrors} API errors).`);
