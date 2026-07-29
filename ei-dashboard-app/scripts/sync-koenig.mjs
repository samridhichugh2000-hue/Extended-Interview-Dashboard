// Syncs the `employees` table from the live Koenig Kites "New Joiners" API.
// Upserts only the fields this feed actually owns (name, email, team,
// manager, doj, tenure_days, active) — it never touches status, score,
// hr_note, metric1..6, neg_audits, sc_raised, exam_*, neg_feedback, etc.,
// which are populated by the other sync-*.mjs scripts. Run manually or on a
// schedule (e.g. daily cron) to keep the roster current.
//
// Note: this does not remove employees who've aged out of the 6-month
// window or otherwise stopped appearing in the feed — it only adds/updates,
// never deletes. Pruning stale rows is a separate concern, deliberately not
// handled here.
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

function sixMonthsAgo() {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 6);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
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

const { from, to } = sixMonthsAgo();
const rawNewJoiners = await getNewJoiners(from, to);
const newJoiners = rawNewJoiners
  .filter((nj) => nj.section !== null && nj.empId)
  .map((nj) => ({ ...nj, empId: normalizeEmpId(nj.empId) }));

if (!newJoiners.length) {
  console.error('Koenig API returned zero usable new joiners — aborting without touching Turso.');
  process.exit(1);
}

const existing = await db.execute('SELECT id FROM employees');
const knownIds = new Set(existing.rows.map((r) => r.id));

const seen = new Set();
let inserted = 0;
let updatedCount = 0;
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
  } else {
    await db.execute({
      sql: `INSERT INTO employees (id, name, email, team, manager, doj, tenure_days, status, score, trend_note, hr_note, metric1, metric2, metric3, alert, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'In Progress', 0, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
      args: [nj.empId, nj.name, nj.email || null, nj.section, nj.managerName || '—', displayDate(nj.joiningDate), tenureDays(nj.joiningDate), nj.active ? 1 : 0],
    });
    inserted++;
  }
}

console.log(`Synced ${newJoiners.length} live new joiners from Koenig: ${inserted} new, ${updatedCount} updated in place. Other synced columns (NR, utilization, exams, audits, SCs, PIP/PA...) were left untouched.`);
const check = await db.execute('SELECT id, name, team, doj, tenure_days FROM employees ORDER BY tenure_days DESC');
for (const row of check.rows) console.log(' ', row.id, row.name, row.team, row.doj, `day ${row.tenure_days}`);
