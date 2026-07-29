// Syncs Trainer month-wise utilization from the Koenig API into
// employees.metric1..metric6 — the first six calendar months of
// utilization % since each Trainer's own DOJ. Unlike the Sales NR feed,
// this API is per-employee (no bulk endpoint), so it's one call per Trainer.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getMonthlyUtilization } = await import('../lib/koenigUtilApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function monthKey(date) {
  const mon = date.toLocaleString('en-US', { month: 'short' });
  return `${mon} ${date.getFullYear()}`;
}

// First six calendar months of utilization counting from the employee's own
// DOJ (M1 = joining month), matching the six metric columns Sales already
// uses — reconstructed from tenure_days since we don't store a raw ISO DOJ.
function firstSixMonths(tenureDays, months) {
  const doj = new Date();
  doj.setDate(doj.getDate() - tenureDays);
  const out = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(doj.getFullYear(), doj.getMonth() + i, 1);
    const rec = months[monthKey(d)];
    out.push(rec && rec.util !== null ? `${rec.util}%` : '—');
  }
  return out;
}

const trainerEmployees = await db.execute("SELECT id, tenure_days FROM employees WHERE team = 'Trainer'");

let updated = 0;
let unmatched = 0;
for (const emp of trainerEmployees.rows) {
  const empCode = emp.id.replace('EMP', '');
  const data = await getMonthlyUtilization(empCode);
  if (!data) { unmatched++; continue; }

  const values = firstSixMonths(emp.tenure_days, data.months);
  await db.execute({
    sql: 'UPDATE employees SET metric1 = ?, metric2 = ?, metric3 = ?, metric4 = ?, metric5 = ?, metric6 = ? WHERE id = ?',
    args: [...values, emp.id],
  });
  updated++;
}

console.log(`Synced utilization for ${updated} Trainer employees (${unmatched} had no matching record).`);
const check = await db.execute("SELECT id, name, metric1, metric2, metric3, metric4, metric5, metric6 FROM employees WHERE team = 'Trainer' ORDER BY tenure_days DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.metric1, r.metric2, r.metric3, r.metric4, r.metric5, r.metric6);
