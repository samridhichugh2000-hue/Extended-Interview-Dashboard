// Regenerates lib/pastMl.js — the static snapshot behind Analysis > "Past ML".
// For every Trainer / Sales employee with a maternity leave (any approval
// status, 30+ days) that has already started, it records the leave period and
// the six months BEFORE the leave, month by month:
//   Trainer: utilisation %, hours, assignments started
//   Sales:   NR, quarter target, target achievement (quarter-to-date True NR /
//            quarter target — True NR only), True NR, SCs raised
// Leave comes from the Koenig "Get Employee Leave Details" feed (apikey 237),
// monthly history from employee_monthly_history (scripts/backfill-history.mjs)
// plus the employee columns. Needs leave-API credentials in the environment:
//   LU=<username> LP=<password> node scripts/gen-past-ml.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });
const { getDb } = await import('../lib/db.js');
const { computeUtilization } = await import('../lib/utilization.js');
const db = getDb();

const emps = (await db.execute("SELECT * FROM employees WHERE team IN ('Sales','Trainer')")).rows.map((r) => ({ ...r }));
const base = 'https://api.koenig-solutions.com';
const tk = (await (await fetch(`${base}/api/Kites/Operator/GetToken`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName: process.env.LU, userPassword: process.env.LP, userRole: 'Get Employee Leave Details' }) })).json()).content;
if (!tk) throw new Error('leave API login failed — set LU and LP');
const url = `${base}/api/Kites/Operator/common?apikey=237&accessToken=${encodeURIComponent(tk.accessToken)}&deviceToken=${encodeURIComponent(tk.deviceToken)}`;
let ix = 0;
async function worker() {
  while (ix < emps.length) {
    const e = emps[ix++];
    try {
      const j = await (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emp_code: String(e.id).replace(/\D/g, '') }) })).json();
      let r = j.content; if (typeof r === 'string') r = JSON.parse(r);
      e.leaves = r || [];
    } catch { e.leaves = []; }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

const hist = {};
for (const r of (await db.execute("SELECT employee_id, metric, month, value FROM employee_monthly_history")).rows) ((hist[r.employee_id] ??= {})[r.metric] ??= {})[r.month] = r.value;

const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const J = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
const ymOf = (d) => { const s = String(d || '').trim(); let m = s.match(/^(\d{4})-(\d{2})/); if (m) return `${m[1]}-${m[2]}`; m = s.match(/^\d{1,2}[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{4})/); return m && MON[m[1]] ? `${m[2]}-${String(MON[m[1]]).padStart(2, '0')}` : null; };
const monKey = (s) => { const m = String(s).match(/([A-Za-z]{3})[a-z]*[- ](\d{4})/); return m && MON[m[1]] ? `${m[2]}-${String(MON[m[1]]).padStart(2, '0')}` : null; };
const mi = (ym) => { const [y, m] = ym.split('-').map(Number); return y * 12 + m - 1; };
const fromMi = (n) => `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`;
const qStart = (ym) => { const [y, m] = ym.split('-').map(Number); return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}`; };
const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const TODAY = '2026-10-26';

const cases = [];
for (const e of emps) {
  const rows = e.leaves.filter((r) => /matern/i.test(r.leave_type || '') && Math.round((new Date(r.to_date) - new Date(r.from_date)) / 864e5) + 1 >= 30);
  if (!rows.length) continue;
  const live = rows.filter((r) => r.leave_status !== 'Rejected');
  const use = live.length ? live : rows;
  const from = use.map((r) => r.from_date.slice(0, 10)).sort()[0];
  const to = use.map((r) => r.to_date.slice(0, 10)).sort().slice(-1)[0];
  if (from > TODAY) continue; // not started yet
  const approval = use.some((r) => r.leave_status === 'Approved') ? 'Approved' : live.length ? 'In process' : 'Rejected';
  const s = mi(from.slice(0, 7));
  const months = Array.from({ length: 6 }, (_, i) => fromMi(s - 6 + i));
  const h = hist[e.id] || {};
  const d = new Date(e.doj);
  const dojYm = isNaN(d) ? '0000-00' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const afterJoin = (ym) => ym >= dojYm;
  const series = (keyFn) => months.map((m) => keyFn(m));
  let rowsOut;
  if (e.team === 'Trainer') {
    const util = {}, hrs = {};
    for (const x of J(e.util_monthly_details)) { const k = monKey(x.month); if (k) { util[k] = Number(x.util); hrs[k] = Number(x.hours); } }
    // Same formula as the dashboard (lib/utilization.js) over the backfilled SC / Non-SC hours; falls back to the synced figure.
    const utilPct = (m) => (h.util_sc_hours?.[m] !== undefined ? Math.round(computeUtilization(h.util_sc_hours[m], h.util_nonsc_hours?.[m] ?? 0).util) : round(util[m], 0) ?? null);
    const asg = {};
    for (const x of J(e.assignments_details)) { const k = ymOf(x.startDate); if (k) asg[k] = (asg[k] || 0) + 1; }
    rowsOut = [
      { key: 'util', label: 'Utilisation', kind: 'pct', values: series(utilPct) },
      { key: 'hours', label: 'Hours delivered', kind: 'hours', values: series((m) => round(h.util_total_hours?.[m] ?? hrs[m], 0) ?? null) },
      { key: 'assign', label: 'Assignments started', kind: 'count', values: series((m) => (afterJoin(m) && m >= '2020-01' ? (h.assignments_started?.[m] ?? asg[m] ?? 0) : null)) },
    ];
  } else {
    const nr = {};
    for (const x of J(e.nr_monthly_details)) { const k = monKey(x.month); if (k) nr[k] = Number(x.nr); }
    const sc = {};
    for (const x of J(e.sc_details)) { const k = ymOf(x.createdOn); if (k) sc[k] = (sc[k] || 0) + 1; }
    const trueNr = (m) => (afterJoin(m) && h.true_nr?.[m] !== undefined ? h.true_nr[m] : null);
    const target = (m) => h.quarter_target?.[qStart(m)] ?? null;
    const ach = (m) => {
      const t = target(m);
      if (!t) return null;
      let sum = 0;
      for (let k = mi(qStart(m)); k <= mi(m); k++) { const v = trueNr(fromMi(k)); if (v == null) return null; sum += v; }
      return round((sum / t) * 100, 0);
    };
    rowsOut = [
      { key: 'nr', label: 'NR', kind: 'money', values: series((m) => nr[m] ?? h.nr_gross?.[m] ?? null) },
      { key: 'target', label: 'Quarter target', kind: 'money', values: series(target) },
      { key: 'ach', label: 'Target achieved (True NR, quarter to date)', kind: 'pct', values: series(ach) },
      { key: 'truenr', label: 'True NR', kind: 'money', values: series(trueNr) },
      { key: 'sc', label: 'SCs raised', kind: 'count', values: series((m) => (m >= '2024-10' && afterJoin(m) ? (sc[m] || 0) : null)) },
    ];
  }
  cases.push({ id: e.id, name: e.name, team: e.team, mlFrom: from, mlTo: to, approval, months, rows: rowsOut });
}
cases.sort((a, b) => (a.mlFrom < b.mlFrom ? 1 : -1));

const src = `// Snapshot behind Analysis > "Past ML", generated ${TODAY} by scripts/gen-past-ml.mjs
// (re-run it to refresh). Static on purpose: it describes leaves that already
// started. Review only — NOT used by the Worry Index, PA or PIP.
// Per person: the leave period and the six months before it, month by month.
// null = no data for that month (before joining, or before the feed's history).
export const PAST_ML = ${JSON.stringify({ generated: TODAY, cases }, null, 1)};
`;
fs.writeFileSync(path.join(__dirname, '..', 'lib', 'pastMl.js'), src);
console.log(`${cases.length} cases (${cases.filter((c) => c.team === 'Trainer').length} Trainer, ${cases.filter((c) => c.team === 'Sales').length} Sales) written to lib/pastMl.js`);
