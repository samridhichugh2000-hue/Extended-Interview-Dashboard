// Precomputes whether each active Trainer is booked for 40+ 'SC' (Scheduled
// Class) hours in the current ISO week, into employees.rc_fully_booked_week/
// rc_fully_booked_sc_hours. weeklyReportRunner's Monday check-in send reads
// these instead of calling Koenig's RC Schedule API live, per Trainer,
// inside its own 60s-limited request — that inline loop is what timed the
// whole 2026-09-28 Monday send out before any NJ/PA/PIP check-in email went
// out. Meant to run on its own external cron-job.org schedule ~8AM IST,
// ahead of weeklyreport's 9AM IST send — NOT part of scripts/sync-all.mjs's
// daily batch, since that batch's run time isn't guaranteed to land before
// 9AM. Same Monday-only gate as the sends themselves.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getTrainerRcSchedule, totalScHours } = await import('../lib/koenigTrainerRcApi.js');
const { getIsoWeek, weekDateRange, istDateKey, isMondayIst } = await import('../lib/weekUtils.js');

if (!isMondayIst()) {
  console.log('Skipped — RC fully-booked check only runs Monday (IST), ahead of the weekly check-in send.');
  process.exit(0);
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const week = getIsoWeek(new Date());
const { start, end } = weekDateRange(week);
const fromDate = istDateKey(start);
const toDate = istDateKey(end);

const trainerEmployees = await db.execute("SELECT id, email FROM employees WHERE team = 'Trainer' AND active = 1");

let checked = 0;
let skippedNoEmail = 0;
let apiErrors = 0;
for (const emp of trainerEmployees.rows) {
  if (!emp.email) { skippedNoEmail++; continue; }
  try {
    const rows = await getTrainerRcSchedule(emp.email, fromDate, toDate);
    const hours = totalScHours(rows);
    await db.execute({
      sql: 'UPDATE employees SET rc_fully_booked_week = ?, rc_fully_booked_sc_hours = ? WHERE id = ?',
      args: [week, hours, emp.id],
    });
    checked++;
  } catch (err) {
    console.error(`RC fully-booked check failed for ${emp.id}, leaving stale:`, err.message);
    apiErrors++;
  }
}

console.log(`Checked RC schedule for ${checked} active Trainers for ${week} (${skippedNoEmail} no email on file, ${apiErrors} API errors — those fail open in Monday's check-in send).`);
