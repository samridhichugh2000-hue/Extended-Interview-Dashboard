// Syncs the Trainer Exam Summary into employees.exam_pass/exam_fail,
// Trainer team only. Per-employee API like utilization — one call per
// Trainer, matched directly by EmpCode (no fuzzy name matching needed).
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getExamSummary } = await import('../lib/koenigExamApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const trainerEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Trainer'");

let updated = 0;
let unmatched = 0;
for (const emp of trainerEmployees.rows) {
  const empCode = emp.id.replace('EMP', '');
  const summary = await getExamSummary(empCode);
  if (!summary) { unmatched++; continue; }

  await db.execute({
    sql: 'UPDATE employees SET exam_pass = ?, exam_fail = ?, exam_total = ?, exam_not_updated = ? WHERE id = ?',
    args: [summary.passCount, summary.failCount, summary.totalExam, summary.statusNotUpdated, emp.id],
  });
  updated++;
}

console.log(`Synced exam data for ${updated} Trainer employees (${unmatched} had no matching record).`);
const check = await db.execute("SELECT id, name, exam_pass, exam_fail, exam_total, exam_not_updated FROM employees WHERE team = 'Trainer' ORDER BY tenure_days DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.exam_pass, r.exam_fail, r.exam_total, r.exam_not_updated);
