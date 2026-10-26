// One-off, resumable backfill of long monthly history into a SEPARATE table
// (employee_monthly_history) — nothing on `employees` or the dashboard changes.
// Feeds the maternity-leave "what happened in the months before" study.
//
//   node scripts/backfill-history.mjs                 # all stages
//   node scripts/backfill-history.mjs --only=truenr   # truenr | target | assign | util | rc
//
// Stages: truenr (Sales, from Jan 2022), target (Sales quarter targets + gross NR), assign (Trainers, from 2020),
// util + rc (Trainers, per month from 2023 or joining, whichever is later —
// paced, because Koenig answers "Execution Timeout Expired" under load).
// Months already stored are skipped, so an interrupted run just resumes; the
// current and previous month are always re-fetched.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getDb } = await import('../lib/db.js');
const db = getDb();
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const run = (stage) => !only || only === stage;
// --from=YYYY-MM moves the per-month floor earlier than 2023-01; --ids=EMP1,EMP2 limits util/rc to those trainers.
const FLOOR = (process.argv.find((a) => a.startsWith('--from=')) || '').slice(7) || '2023-01';
const IDS = (process.argv.find((a) => a.startsWith('--ids=')) || '').slice(6).split(',').filter(Boolean);

await db.execute(`CREATE TABLE IF NOT EXISTS employee_monthly_history (
  employee_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  month TEXT NOT NULL,          -- YYYY-MM
  value REAL NOT NULL,
  PRIMARY KEY (employee_id, metric, month)
)`);

const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const ymOf = (d) => {
  const s = String(d || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^\d{1,2}[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{4})/);
  if (m && MON[m[1]]) return `${m[2]}-${String(MON[m[1]]).padStart(2, '0')}`;
  return null;
};
const monKey = (s) => { const m = String(s).match(/^([A-Za-z]{3})-(\d{4})$/); return m && MON[m[1]] ? `${m[2]}-${String(MON[m[1]]).padStart(2, '0')}` : null; };
const mi = (ym) => { const [y, m] = ym.split('-').map(Number); return y * 12 + m - 1; };
const fromMi = (n) => `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`;
const NOW = new Date();
const CUR = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`;
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };

async function save(rows) {
  for (let i = 0; i < rows.length; i += 300) {
    await db.batch(rows.slice(i, i + 300).map((r) => ({
      sql: 'INSERT OR REPLACE INTO employee_monthly_history (employee_id, metric, month, value) VALUES (?, ?, ?, ?)',
      args: r,
    })), 'write');
  }
}

const all = (await db.execute('SELECT id, team, doj, email FROM employees')).rows;
const byNum = new Map(all.map((e) => [parseInt(String(e.id).replace(/\D/g, ''), 10), e]));

// ---- True NR (Sales) -------------------------------------------------------
if (run('truenr')) {
  const { getTrueNrAll } = await import('../lib/koenigTrueNrApi.js');
  const rows = await getTrueNrAll('2020-01-01', `${CUR}-${lastDay(CUR)}`);
  const out = [];
  let matched = 0;
  for (const r of rows) {
    const e = byNum.get(r.empId);
    if (!e) continue;
    matched++;
    for (const [k, v] of Object.entries(r.monthlyRevenue || {})) {
      const ym = monKey(k);
      if (ym && ym <= CUR) out.push([e.id, 'true_nr', ym, Number(v) || 0]);
    }
  }
  await save(out);
  console.log(`true NR: ${matched} of ${rows.length} feed rows matched, ${out.length} month values saved`);
}

// ---- Quarter targets + gross NR (Sales) ------------------------------------
// Koenig's own "target achieved %" feed returns no rows, so achievement is
// worked out later as the quarter's gross NR / quarter_target. quarter_target
// is stored on the quarter's FIRST calendar month (Q1 Jan-Mar, Q2 Apr-Jun,
// ...); nr_gross is the Employee NR feed (without salary/marketing cost),
// whose window only starts May 2025, so earlier quarters have a target but no
// gross NR (use true_nr for those, knowing it is net of cost).
if (run('target')) {
  const { getTargetsData } = await import('../lib/koenigTargetsDataApi.js');
  const { getEmployeeNr } = await import('../lib/koenigNrApi.js');
  const targets = await getTargetsData();
  const out = [];
  let tm = 0;
  for (const t of targets) {
    const e = byNum.get(Number(t.empId));
    const q = Number(String(t.targetName).replace(/\D/g, ''));
    if (!e || !q || !t.targetYear) continue;
    tm++;
    out.push([e.id, 'quarter_target', `${t.targetYear}-${String((q - 1) * 3 + 1).padStart(2, '0')}`, Number(t.target) || 0]);
  }
  const nrRows = await getEmployeeNr();
  let nm = 0;
  for (const r of nrRows) {
    const e = byNum.get(r.empId);
    if (!e) continue;
    nm++;
    const d = new Date(e.doj);
    const dojYm = isNaN(d) ? '0000-00' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    for (const [k, v] of Object.entries(r.monthlyRevenue || {})) {
      const ym = monKey(k);
      if (ym && ym <= CUR && ym >= dojYm) out.push([e.id, 'nr_gross', ym, Number(v) || 0]);
    }
  }
  await save(out);
  console.log(`targets: ${tm} quarter targets matched; gross NR: ${nm} employees; ${out.length} values saved`);
}

// ---- Assignments (Trainers) ------------------------------------------------
if (run('assign')) {
  const { getTrainerAssignments } = await import('../lib/koenigAssignmentApi.js');
  const rows = await getTrainerAssignments('2020-01-01', `${CUR}-${lastDay(CUR)}`);
  const cnt = new Map();
  for (const r of rows) {
    const e = byNum.get(parseInt(String(r.empCode).replace(/\D/g, ''), 10));
    const ym = ymOf(r.startDate);
    if (!e || !ym || ym > CUR) continue;
    const k = `${e.id}|${ym}`;
    const c = cnt.get(k) || { n: 0, pax: 0 };
    c.n++; c.pax += Number(r.totalPax) || 0;
    cnt.set(k, c);
  }
  const out = [];
  for (const [k, c] of cnt) { const [id, ym] = k.split('|'); out.push([id, 'assignments_started', ym, c.n], [id, 'assignments_pax', ym, c.pax]); }
  await save(out);
  console.log(`assignments: ${rows.length} feed rows, ${cnt.size} employee-months saved`);
}

// ---- Utilization + RC schedule (Trainers, per month) ----------------------
async function perMonth(stage, metrics, fetchMonth) {
  const trainers = all.filter((e) => e.team === 'Trainer' && (!IDS.length || IDS.includes(e.id)));
  const have = new Set((await db.execute(`SELECT employee_id || '|' || month AS k FROM employee_monthly_history WHERE metric = '${metrics[0]}'`)).rows.map((r) => r.k));
  const prev = fromMi(mi(CUR) - 1);
  const jobs = [];
  for (const e of trainers) {
    const d = new Date(e.doj);
    const start = isNaN(d) ? '2023-01' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    for (let k = mi(start < FLOOR ? FLOOR : start); k <= mi(CUR); k++) {
      const ym = fromMi(k);
      if (have.has(`${e.id}|${ym}`) && ym !== CUR && ym !== prev) continue;
      jobs.push({ e, ym });
    }
  }
  console.log(`${stage}: ${jobs.length} trainer-months to fetch`);
  let i = 0, done = 0, failed = 0;
  async function worker() {
    while (i < jobs.length) {
      const { e, ym } = jobs[i++];
      try {
        const vals = await fetchMonth(e, ym);
        await save(Object.entries(vals).map(([m, v]) => [e.id, m, ym, v]));
      } catch (err) { failed++; if (failed <= 5) console.log(`  ${stage} ${e.id} ${ym} failed: ${err.message}`); }
      if (++done % 500 === 0) console.log(`  ${stage}: ${done}/${jobs.length} (failed ${failed})`);
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker));
  console.log(`${stage}: done, ${failed} failed (re-run to retry them)`);
}

if (run('util')) {
  const { getMonthlyScHours } = await import('../lib/koenigUtilScApi.js');
  await perMonth('util', ['util_total_hours', 'util_sc_hours', 'util_nonsc_hours'], async (e, ym) => {
    const [y, m] = ym.split('-').map(Number);
    const h = await getMonthlyScHours(String(e.id).replace(/\D/g, ''), y, m - 1);
    return { util_total_hours: h.totalHours, util_sc_hours: h.scHours, util_nonsc_hours: h.nonScHours };
  });
}

if (run('rc')) {
  const { getTrainerRcSchedule, totalScHours, distinctMainTrainerAssignments } = await import('../lib/koenigTrainerRcApi.js');
  await perMonth('rc', ['rc_sc_hours', 'rc_main_assignments', 'rc_leave_days', 'rc_free_hours'], async (e, ym) => {
    if (!e.email) throw new Error('no email');
    const rows = await getTrainerRcSchedule(e.email, `${ym}-01`, `${ym}-${lastDay(ym)}`);
    const lv = new Set(rows.filter((r) => r.associatedType === 'LV').map((r) => String(r.date).slice(0, 10)));
    return {
      rc_sc_hours: totalScHours(rows),
      rc_main_assignments: distinctMainTrainerAssignments(rows).length,
      rc_leave_days: lv.size,
      rc_free_hours: rows.filter((r) => r.associatedType === 'Free').reduce((s, r) => s + r.hrsPerDay, 0),
    };
  });
}

console.log('backfill finished');
