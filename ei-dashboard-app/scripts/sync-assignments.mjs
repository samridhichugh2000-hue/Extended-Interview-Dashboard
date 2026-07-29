// Syncs Trainer assignments delivered from the Koenig "Get Trainer
// Assignment" API into employees.assignments_count/assignments_details,
// Trainer team only. Matched directly by trainer_emp_code — no fuzzy
// name/email matching needed, unlike the enquiry audit feed.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getTrainerAssignments } = await import('../lib/koenigAssignmentApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Go wide — an NJ's assignments can span their whole tenure to date.
const rows = await getTrainerAssignments('2020-01-01', '2030-01-01');

const byEmpCode = new Map();
for (const r of rows) {
  if (!byEmpCode.has(r.empCode)) byEmpCode.set(r.empCode, []);
  byEmpCode.get(r.empCode).push(r);
}

const trainerEmployees = await db.execute("SELECT id, tenure_days FROM employees WHERE team = 'Trainer'");

// Emp codes get recycled — a code's prior occupant can have assignment rows
// dating years before the current NJ joined. Reconstruct the join date from
// tenure_days and only count assignments starting on/after it (same fix
// applied to sync-sc.mjs for the same reason).
function joinDate(tenureDays) {
  const d = new Date();
  d.setDate(d.getDate() - tenureDays);
  d.setHours(0, 0, 0, 0);
  return d;
}

let updated = 0;
let unmatched = 0;
let excludedPreJoin = 0;
for (const emp of trainerEmployees.rows) {
  const empCode = parseInt(emp.id.replace('EMP', ''), 10);
  const since = joinDate(emp.tenure_days);
  const all = byEmpCode.get(empCode) || [];
  const assignments = all
    .filter((a) => new Date(a.startDate) >= since)
    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
  excludedPreJoin += all.length - assignments.length;

  const details = assignments.map((a) => ({
    assignmentId: a.assignmentId,
    courseName: a.courseName,
    startDate: a.startDate,
    endDate: a.endDate,
    totalPax: a.totalPax,
    deliveryMode: a.deliveryMode,
    batchType: a.batchType,
  }));
  await db.execute({
    sql: 'UPDATE employees SET assignments_count = ?, assignments_details = ? WHERE id = ?',
    args: [assignments.length, JSON.stringify(details), emp.id],
  });
  if (assignments.length) updated++; else unmatched++;
}

console.log(`Synced assignment data for Trainer roster — ${updated} employees have at least one assignment (${unmatched} have none; ${excludedPreJoin} pre-join rows excluded as recycled-emp-code noise).`);
const check = await db.execute("SELECT id, name, assignments_count FROM employees WHERE team = 'Trainer' AND assignments_count > 0 ORDER BY assignments_count DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.assignments_count);
