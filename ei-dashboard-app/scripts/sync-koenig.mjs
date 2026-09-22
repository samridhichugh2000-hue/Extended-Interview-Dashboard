// Syncs the `employees` table from the live Koenig Kites "New Joiners" API.
// Upserts only the fields this feed actually owns (name, email, team,
// manager, doj, tenure_days, active) — it never touches status, score,
// hr_note, metric1..6, neg_audits, sc_raised, exam_*, neg_feedback, etc.,
// which are populated by the other sync-*.mjs scripts. Run manually or on a
// schedule (e.g. daily cron) to keep the roster current.
//
// Every currently-active Sales/Trainer/PT Team employee gets inserted, not
// just ones within the original 6-month "new joiner" tracking horizon —
// this used to gate inserts on tenure_days < 182, which meant anyone who
// was already a longer-tenured employee the first time this ever synced
// them was silently never imported at all. That left the dashboard's
// "All employees" view showing e.g. 25 of Sales' real 108 active headcount.
// The fetch window (FETCH_FROM) still needs to go back far enough to
// actually see those older joiners in the first place, and stays wide for
// the same reason afterward — Koenig's `active` flag is only returned for
// rows inside the queried from/to range, so already-known rows need to
// keep falling inside it to get fresh active/tenure_days updates too.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getNewJoiners } = await import('../lib/koenigApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const FETCH_FROM = '2000-01-01';

function fetchRange() {
  const to = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: FETCH_FROM, to: fmt(to) };
}

function displayDate(raw) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw || '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, ' ');
}

function tenureDays(raw) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function normalizeEmpId(raw) {
  const n = Math.trunc(Number(raw));
  return 'EMP' + (Number.isFinite(n) ? n : String(raw).trim());
}

const { from, to } = fetchRange();
const rawNewJoiners = await getNewJoiners(from, to);
const skipped = rawNewJoiners.filter((nj) => nj.section === null || !nj.empId);
const newJoiners = rawNewJoiners
  .filter((nj) => nj.section !== null && nj.empId)
  .map((nj) => ({ ...nj, empId: normalizeEmpId(nj.empId) }));

if (skipped.length) {
  console.warn(`Skipped ${skipped.length} of ${rawNewJoiners.length} rows from Koenig (missing section and/or empId):`);
  for (const nj of skipped) console.warn('  ', nj.empId ?? '(no empId)', nj.name ?? '(no name)', 'section:', nj.section);
}

if (!newJoiners.length) {
  console.error('Koenig API returned zero usable new joiners — aborting without touching Turso.');
  process.exit(1);
}

const existing = await db.execute('SELECT id FROM employees');
const knownIds = new Set(existing.rows.map((r) => r.id));

const seen = new Set();
let inserted = 0;
let updatedCount = 0;
let skippedInactive = 0;
for (const nj of newJoiners) {
  if (seen.has(nj.empId)) continue; // Koenig occasionally repeats a row across paginated date windows
  seen.add(nj.empId);

  if (knownIds.has(nj.empId)) {
    await db.execute({
      sql: `UPDATE employees SET name = ?, email = ?, team = ?, manager = ?, doj = ?, tenure_days = ?, active = ?
            WHERE id = ?`,
      args: [nj.name, nj.email || null, nj.section, nj.managerName || '—', displayDate(nj.joiningDate), tenureDays(nj.joiningDate), nj.active ? 1 : 0, nj.empId],
    });
    updatedCount++;
  } else if (nj.active) {
    await db.execute({
      sql: `INSERT INTO employees (id, name, email, team, manager, doj, tenure_days, status, score, trend_note, hr_note, metric1, metric2, metric3, alert, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'In Progress', 0, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
      args: [nj.empId, nj.name, nj.email || null, nj.section, nj.managerName || '—', displayDate(nj.joiningDate), tenureDays(nj.joiningDate), 1],
    });
    inserted++;
  } else {
    skippedInactive++; // already exited and never tracked before — not worth importing
  }
}

console.log(`Synced from Koenig (${from} to ${to}): ${inserted} new, ${updatedCount} updated in place${skippedInactive ? `, ${skippedInactive} already-exited untracked rows ignored` : ''}. Other synced columns (NR, utilization, exams, audits, SCs, PIP/PA...) were left untouched.`);
const check = await db.execute('SELECT id, name, team, doj, tenure_days, active FROM employees ORDER BY tenure_days DESC');
for (const row of check.rows) console.log(' ', row.id, row.name, row.team, row.doj, `day ${row.tenure_days}`, row.active ? 'active' : 'INACTIVE');
