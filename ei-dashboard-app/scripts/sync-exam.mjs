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

// Bounded concurrency — a plain sequential loop over ~350+ Trainers at
// ~300ms-1s/call took minutes, past Vercel's 60s cron limit (confirmed
// live: only a fraction of the roster was ever getting synced).
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
let unmatched = 0;
await mapWithConcurrency(trainerEmployees.rows, CONCURRENCY, async (emp) => {
  const empCode = emp.id.replace('EMP', '');
  const summary = await getExamSummary(empCode);
  if (!summary) { unmatched++; return; }

  await db.execute({
    sql: 'UPDATE employees SET exam_pass = ?, exam_fail = ?, exam_total = ?, exam_not_updated = ? WHERE id = ?',
    args: [summary.passCount, summary.failCount, summary.totalExam, summary.statusNotUpdated, emp.id],
  });
  updated++;
});

console.log(`Synced exam data for ${updated} Trainer employees (${unmatched} had no matching record).`);
const check = await db.execute("SELECT id, name, exam_pass, exam_fail, exam_total, exam_not_updated FROM employees WHERE team = 'Trainer' ORDER BY tenure_days DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.exam_pass, r.exam_fail, r.exam_total, r.exam_not_updated);
