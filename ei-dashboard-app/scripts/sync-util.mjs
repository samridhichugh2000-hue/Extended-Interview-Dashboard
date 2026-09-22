// Syncs Trainer month-wise utilization from the Koenig API into
// employees.metric1..metric6 — the trailing six calendar months of
// utilization % ending with the current month. Unlike the Sales NR feed,
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

// Trailing 6 calendar months ending with the current one — was "first 6
// months since DOJ", which left this permanently blank for veterans (the
// API's own ~14-month history window rarely reaches back to a multi-year
// employee's actual joining month). M1 is still the oldest of the 6, M6
// the most recent, matching the six metric columns Sales already uses.
function lastSixMonths(months) {
  const now = new Date();
  const out = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
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

  const values = lastSixMonths(data.months);
  await db.execute({
    sql: 'UPDATE employees SET metric1 = ?, metric2 = ?, metric3 = ?, metric4 = ?, metric5 = ?, metric6 = ? WHERE id = ?',
    args: [...values, emp.id],
  });
  updated++;
}

console.log(`Synced utilization for ${updated} Trainer employees (${unmatched} had no matching record).`);
const check = await db.execute("SELECT id, name, metric1, metric2, metric3, metric4, metric5, metric6 FROM employees WHERE team = 'Trainer' ORDER BY tenure_days DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.metric1, r.metric2, r.metric3, r.metric4, r.metric5, r.metric6);
