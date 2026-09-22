// Syncs Sales net-revenue (NR) data from the Koenig PMS API into
// employees.metric1..metric6 — the trailing six calendar months of NR
// ending with the current month. Only touches employees already present
// (synced from New Joiners) with team = 'Sales'.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getCCENRData } = await import('../lib/koenigPmsApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function monthKey(date) {
  const mon = date.toLocaleString('en-US', { month: 'short' });
  return `${mon}-${date.getFullYear()}`;
}

// Trailing 6 calendar months ending with the current one — was "first 6
// months since DOJ", which left this permanently blank for anyone whose
// first 6 months predates the ~8-month window this even fetches (i.e.
// every veteran since the full roster import). M1 is still the oldest of
// the 6, M6 the most recent, matching the six metric columns the Sales
// table renders; genuine NJs barely notice the change since their trailing
// 6 months already mostly overlaps their actual tenure.
function lastSixMonths(monthlyRevenue) {
  const now = new Date();
  const out = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const raw = monthlyRevenue[monthKey(d)];
    out.push(raw !== undefined ? formatLakhs(raw) : '—');
  }
  return out;
}

function formatLakhs(raw) {
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  return '₹' + (n / 100000).toFixed(1) + 'L';
}

// 8 months back gives a little buffer beyond the trailing 6-month window
// lastSixMonths actually needs.
function eightMonthsAgo() {
  const d = new Date();
  d.setMonth(d.getMonth() - 8);
  return d.toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

const nrRows = await getCCENRData(eightMonthsAgo(), today());
const nrByEmpId = new Map(nrRows.map((r) => [r.empId, r]));

const salesEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Sales'");

let updated = 0;
let unmatched = 0;
for (const row of salesEmployees.rows) {
  const empId = parseInt(row.id.replace('EMP', ''), 10);
  const nr = nrByEmpId.get(empId);
  if (!nr) { unmatched++; continue; }

  const months = lastSixMonths(nr.monthlyRevenue);
  await db.execute({
    sql: 'UPDATE employees SET metric1 = ?, metric2 = ?, metric3 = ?, metric4 = ?, metric5 = ?, metric6 = ? WHERE id = ?',
    args: [...months, row.id],
  });
  updated++;
}

console.log(`Synced NR for ${updated} Sales employees (${unmatched} had no matching PMS record).`);
const check = await db.execute("SELECT id, name, metric1, metric2, metric3, metric4, metric5, metric6 FROM employees WHERE team = 'Sales' ORDER BY tenure_days DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.metric1, r.metric2, r.metric3, r.metric4, r.metric5, r.metric6);
