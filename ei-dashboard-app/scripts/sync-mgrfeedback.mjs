// Syncs Manager Feedback from the Koenig "GetIncidentData" (Sakshipandey)
// API into employees.mgr_feedback_count / mgr_feedback_details. Common
// across every department (Sales, Trainer, PT Team) — unlike the audit
// feed, ReporteeEmpID carries the employee code directly, so matching is a
// plain id lookup, no fuzzy name matching required.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getManagerFeedback } = await import('../lib/koenigManagerFeedbackApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function joinDate(tenureDays) {
  const d = new Date();
  d.setDate(d.getDate() - tenureDays);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Go wide — feedback can span an employee's whole tenure, and the feed is
// cheap to fetch in one call regardless.
const rows = await getManagerFeedback('01-Jan-2020', '01-Jan-2030');

const byEmpCode = new Map();
for (const r of rows) {
  if (!byEmpCode.has(r.empCode)) byEmpCode.set(r.empCode, []);
  byEmpCode.get(r.empCode).push(r);
}

const allEmployees = await db.execute("SELECT id, tenure_days FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team')");

// Emp codes get recycled, same as SC/assignments — reconstruct each
// employee's join date from tenure_days and only count feedback dated
// on/after it, so a reused code's prior occupant doesn't attach here.
const statements = [];
let updated = 0;
let confirmedZero = 0;
let excludedPreJoin = 0;
for (const emp of allEmployees.rows) {
  const empCode = parseInt(emp.id.replace('EMP', ''), 10);
  const since = joinDate(emp.tenure_days);
  const all = byEmpCode.get(empCode) || [];
  const feedback = all.filter((f) => new Date(f.date) >= since).sort((a, b) => new Date(b.date) - new Date(a.date));
  excludedPreJoin += all.length - feedback.length;

  const details = feedback.map((f) => ({
    managerEmpCode: f.managerEmpCode,
    managerName: f.managerName,
    strength: f.strength,
    improvement: f.improvement,
    other: f.other,
    date: f.date,
  }));
  statements.push({
    sql: 'UPDATE employees SET mgr_feedback_count = ?, mgr_feedback_details = ? WHERE id = ?',
    args: [feedback.length, JSON.stringify(details), emp.id],
  });
  if (feedback.length) updated++; else confirmedZero++;
}

if (statements.length) await db.batch(statements, 'write');

console.log(`Synced manager feedback for ${updated} employees with matched records (${confirmedZero} confirmed at 0 since join; ${excludedPreJoin} pre-join rows excluded as recycled-emp-code noise).`);
const check = await db.execute("SELECT id, name, team, mgr_feedback_count FROM employees WHERE mgr_feedback_count > 0 ORDER BY mgr_feedback_count DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.team, r.mgr_feedback_count);
