// Daily snapshot of the EI (Worry) Index — one row per active employee per
// day per scoring window, with the full per-signal break-up, so a past score
// can be compared with today's. Snapshots are append-only history: a re-run on
// the same IST day overwrites that day's rows, nothing older is ever touched.
//
// Windows recorded: 'all' (all-time — the score getEmployees() reports) and
// '3month' (the default window on the Worry Index screens). Other windows
// (weekly/monthly/6-month/custom) can be re-derived live and aren't stored.
//
// signals JSON: [{ l: label, s: status (fired|clear|no-data|not-tracked|
// not-windowed), n: count (fired only), u: weight per occurrence, p: points
// contributed, cap: cap applied (only when the model defines one — none
// today) }].
import { getDb } from './db.js';
import { SIGNAL_DEFS, computeSignalReport, computeWorryScore, band, windowSince } from './data.js';

let ensured = false;
async function ensureTable(db) {
  if (ensured) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS ei_index_snapshots (
    snapshot_date TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    window TEXT NOT NULL,
    team TEXT,
    score REAL,
    band TEXT,
    signals TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (snapshot_date, employee_id, window)
  )`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_ei_snap_emp ON ei_index_snapshots (employee_id, window, snapshot_date)');
  ensured = true;
}

const SNAPSHOT_WINDOWS = [{ key: 'all', days: null }, { key: '3month', days: 91 }];
const unitByLabel = new Map(SIGNAL_DEFS.map((d) => [d.label, d]));

export function istDate(date = new Date()) {
  return new Date(date.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
}

function compactSignals(report) {
  return report.map((s) => {
    const def = unitByLabel.get(s.label);
    const out = { l: s.label, s: s.status, p: s.status === 'fired' ? s.pts : 0, u: def ? def.pts : null };
    if (s.status === 'fired' && s.count != null) out.n = s.count;
    if (def && def.cap != null) out.cap = def.cap;
    return out;
  });
}

export async function takeEiSnapshot() {
  const db = getDb();
  await ensureTable(db);
  const { getEmployees, getGraphMeetings, attachExternalMeetingDates } = await import('./queries.js');
  const employees = attachExternalMeetingDates((await getEmployees()).filter((e) => e.active !== false), await getGraphMeetings());

  const date = istDate();
  const createdAt = new Date().toISOString();
  const stmts = [];
  for (const e of employees) {
    for (const w of SNAPSHOT_WINDOWS) {
      const since = windowSince(w.days);
      const report = computeSignalReport(e, since ? { since } : {});
      const score = computeWorryScore(report.filter((s) => s.status === 'fired'));
      stmts.push({
        sql: `INSERT INTO ei_index_snapshots (snapshot_date, employee_id, window, team, score, band, signals, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(snapshot_date, employee_id, window) DO UPDATE SET
                team = excluded.team, score = excluded.score, band = excluded.band, signals = excluded.signals, created_at = excluded.created_at`,
        args: [date, e.id, w.key, e.team, score, band(score).label, JSON.stringify(compactSignals(report)), createdAt],
      });
    }
  }
  for (let i = 0; i < stmts.length; i += 200) await db.batch(stmts.slice(i, i + 200), 'write');
  return { message: `Recorded EI Index snapshot for ${date}: ${employees.length} active employees × ${SNAPSHOT_WINDOWS.length} windows.` };
}

// Score over time for one employee — newest `days` days of snapshots.
export async function getEiHistory(employeeId, window = 'all', days = 180) {
  const db = getDb();
  await ensureTable(db);
  const res = await db.execute({
    sql: `SELECT snapshot_date, score, band FROM ei_index_snapshots
          WHERE employee_id = ? AND window = ? AND snapshot_date >= ?
          ORDER BY snapshot_date ASC`,
    args: [employeeId, window, istDate(new Date(Date.now() - days * 86400000))],
  });
  return res.rows.map((r) => ({ date: r.snapshot_date, score: r.score, band: r.band }));
}

// One day's full break-up for one employee.
export async function getEiSnapshot(employeeId, window, date) {
  const db = getDb();
  await ensureTable(db);
  const res = await db.execute({
    sql: 'SELECT snapshot_date, score, band, signals FROM ei_index_snapshots WHERE employee_id = ? AND window = ? AND snapshot_date = ?',
    args: [employeeId, window, date],
  });
  const r = res.rows[0];
  return r ? { date: r.snapshot_date, score: r.score, band: r.band, signals: JSON.parse(r.signals) } : null;
}
