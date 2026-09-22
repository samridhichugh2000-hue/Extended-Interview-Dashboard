// Syncs Manager Feedback from the Koenig "GetIncidentData" (Sakshipandey)
// API into employees.mgr_feedback_count / mgr_feedback_details. Common
// across every department (Sales, Trainer, PT Team) — unlike the audit
// feed, ReporteeEmpID carries the employee code directly, so matching is a
// plain id lookup, no fuzzy name matching required.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getManagerFeedback } = await import('../lib/koenigManagerFeedbackApi.js');
const { classifyFeedback } = await import('../lib/classifyFeedback.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Keyed by date+managerEmpCode+strength+improvement+other, so a re-run only
// pays for an OpenAI call on entries that are actually new — everything
// already classified last time is reused verbatim.
function entryKey(f) {
  return [f.date, f.managerEmpCode, f.strength, f.improvement, f.other].join('|');
}
const existing = await db.execute("SELECT mgr_feedback_details FROM employees WHERE mgr_feedback_details IS NOT NULL AND mgr_feedback_details != '[]'");
const classifyCache = new Map();
for (const row of existing.rows) {
  for (const d of JSON.parse(row.mgr_feedback_details || '[]')) {
    if (d.aiRating) classifyCache.set(entryKey(d), { rating: d.aiRating, reason: d.aiReason });
  }
}

// Capped to at most the last 2 years regardless of actual tenure — same fix
// as sync-sc.mjs/sync-assignments.mjs, for the same reason (a multi-year
// veteran's feedback count should reflect recent history, not their full
// career total).
const MGR_FEEDBACK_LOOKBACK_DAYS = 730;
function sinceDate(tenureDays) {
  const joined = new Date();
  joined.setDate(joined.getDate() - tenureDays);
  joined.setHours(0, 0, 0, 0);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MGR_FEEDBACK_LOOKBACK_DAYS);
  cutoff.setHours(0, 0, 0, 0);
  return joined > cutoff ? joined : cutoff;
}

// Go wide — feedback can span an employee's whole tenure, and the feed is
// cheap to fetch in one call regardless.
const rows = await getManagerFeedback('01-Jan-2020', '01-Jan-2030');

const byEmpCode = new Map();
for (const r of rows) {
  if (!byEmpCode.has(r.empCode)) byEmpCode.set(r.empCode, []);
  byEmpCode.get(r.empCode).push(r);
}

const allEmployees = await db.execute("SELECT id, tenure_days FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team')");

// Emp codes get recycled, same as SC/assignments — reconstruct each
// employee's join date from tenure_days and only count feedback dated
// on/after it, so a reused code's prior occupant doesn't attach here.
//
// Flushed to the DB every FLUSH_EVERY employees rather than once at the
// very end — a single stalled/failed classification call used to mean
// losing every employee's progress if the run never reached the final
// batch (seen in practice: one hung OpenAI call stalled the whole script
// for hours with nothing ever written). Also logs progress periodically
// so a long run isn't silent the whole time.
const FLUSH_EVERY = 25;
let pending = [];
let updated = 0;
let confirmedZero = 0;
let excludedPreJoin = 0;
let classified = 0;
let classifyFailed = 0;
let processed = 0;
async function flush() {
  if (pending.length) await db.batch(pending, 'write');
  pending = [];
}
for (const emp of allEmployees.rows) {
  const empCode = parseInt(emp.id.replace('EMP', ''), 10);
  const since = sinceDate(emp.tenure_days);
  const all = byEmpCode.get(empCode) || [];
  const feedback = all.filter((f) => new Date(f.date) >= since).sort((a, b) => new Date(b.date) - new Date(a.date));
  excludedPreJoin += all.length - feedback.length;

  const details = [];
  for (const f of feedback) {
    const base = { managerEmpCode: f.managerEmpCode, managerName: f.managerName, strength: f.strength, improvement: f.improvement, other: f.other, date: f.date };
    const cached = classifyCache.get(entryKey(base));
    let aiRating = cached?.rating, aiReason = cached?.reason;
    if (!aiRating) {
      try {
        const result = await classifyFeedback(base);
        aiRating = result.rating;
        aiReason = result.reason;
        classified++;
      } catch (err) {
        console.error(`Classify failed for ${emp.id} / ${f.date}:`, err.message);
        classifyFailed++;
      }
    }
    details.push({ ...base, aiRating, aiReason });
  }
  pending.push({
    sql: 'UPDATE employees SET mgr_feedback_count = ?, mgr_feedback_details = ? WHERE id = ?',
    args: [feedback.length, JSON.stringify(details), emp.id],
  });
  if (feedback.length) updated++; else confirmedZero++;

  processed++;
  if (processed % FLUSH_EVERY === 0) {
    await flush();
    console.log(`...${processed}/${allEmployees.rows.length} employees processed, ${classified} classified so far`);
  }
}
await flush();

console.log(`Synced manager feedback for ${updated} employees with matched records (${confirmedZero} confirmed at 0 since join; ${excludedPreJoin} pre-join rows excluded as recycled-emp-code noise). Classified ${classified} new entries via OpenAI${classifyFailed ? `, ${classifyFailed} classification(s) failed (left unrated, keyword fallback applies)` : ''}.`);
const check = await db.execute("SELECT id, name, team, mgr_feedback_count FROM employees WHERE mgr_feedback_count > 0 ORDER BY mgr_feedback_count DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.team, r.mgr_feedback_count);
