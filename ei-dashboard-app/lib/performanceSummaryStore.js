// Server side of the quarterly Performance Summary: persisted state (who HR unchecked, what was sent, whether
// the quarter's batch is done), the "already emailed" lookup against Sent Items, the send itself, and the
// reminder job. Tables are created on first use (CREATE IF NOT EXISTS), same as lib/jobStatus.js — the
// production Turso credentials are write-only, so there is no manual migration step for them.
import { getDb } from './db.js';
import { graphFetch } from './graphAuth.js';
import { sendMail } from './graphMailer.js';
import { getManagerEmail } from './managerDirectory.js';
import {
  buildPerformanceSummary, istToday, quarterOf, quarterKey, quarterLabel, isReminderDay, summarySubject, summaryEmailHtml,
  reminderSubject, reminderHtml, isRecalled, HR_ADDRESS, REMINDER_TO, REMINDER_CC,
} from './performanceSummary.js';

let ensured = false;
async function ensureTables(db) {
  if (ensured) return;
  await db.batch([
    // A row = HR unchecked this CSM for this quarter ("Excluded from Alert").
    `CREATE TABLE IF NOT EXISTS perf_summary_exclusions (quarter_key TEXT NOT NULL, emp_id TEXT NOT NULL, excluded_at TEXT NOT NULL, PRIMARY KEY (quarter_key, emp_id))`,
    `CREATE TABLE IF NOT EXISTS perf_summary_sends (quarter_key TEXT NOT NULL, emp_id TEXT NOT NULL, email TEXT, status TEXT NOT NULL, error TEXT, sent_at TEXT NOT NULL, PRIMARY KEY (quarter_key, emp_id))`,
    // batch_sent_at set = the quarter's summary has been sent, which clears the dashboard note.
    `CREATE TABLE IF NOT EXISTS perf_summary_quarters (quarter_key TEXT PRIMARY KEY, reminder_sent_at TEXT, batch_sent_at TEXT, sent_count INTEGER)`,
  ], 'write');
  ensured = true;
}

export async function getQuarterState(key) {
  const db = getDb();
  await ensureTables(db);
  const [ex, sends, qrow] = await Promise.all([
    db.execute({ sql: 'SELECT emp_id FROM perf_summary_exclusions WHERE quarter_key = ?', args: [key] }),
    db.execute({ sql: 'SELECT emp_id, email, status, error, sent_at FROM perf_summary_sends WHERE quarter_key = ?', args: [key] }),
    db.execute({ sql: 'SELECT reminder_sent_at, batch_sent_at, sent_count FROM perf_summary_quarters WHERE quarter_key = ?', args: [key] }),
  ]);
  const q = qrow.rows[0];
  return {
    excluded: ex.rows.map((r) => r.emp_id),
    sends: sends.rows.map((r) => ({ empId: r.emp_id, email: r.email, status: r.status, error: r.error, sentAt: r.sent_at })),
    reminderSentAt: q?.reminder_sent_at ?? null,
    batchSentAt: q?.batch_sent_at ?? null,
    sentCount: q?.sent_count ?? 0,
  };
}

// Cheap read for the dashboard-wide note: has this quarter's batch been sent yet?
export async function getBatchSentAt(key) {
  const db = getDb();
  await ensureTables(db);
  const r = await db.execute({ sql: 'SELECT batch_sent_at FROM perf_summary_quarters WHERE quarter_key = ?', args: [key] });
  return r.rows[0]?.batch_sent_at ?? null;
}

export async function setExcluded(key, empId, excluded) {
  const db = getDb();
  await ensureTables(db);
  if (excluded) await db.execute({ sql: 'INSERT OR IGNORE INTO perf_summary_exclusions (quarter_key, emp_id, excluded_at) VALUES (?, ?, ?)', args: [key, empId, new Date().toISOString()] });
  else await db.execute({ sql: 'DELETE FROM perf_summary_exclusions WHERE quarter_key = ? AND emp_id = ?', args: [key, empId] });
}

// Who already got this quarter's summary from the app mailbox's Sent Items (to-addresses -> sent time). Catches the
// emails sent before this screen existed (the Q4 2026 round of 9 Nov), so nobody is emailed twice. [TEST] copies and
// "Correction" notices are not the summary itself and are ignored.
export async function getAlreadyEmailed(q) {
  const mailbox = process.env.GRAPH_SENDER_EMAIL;
  const subject = summarySubject(q);
  const out = new Map();
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/sentitems/messages?` + new URLSearchParams({
    $filter: `contains(subject,'${subject.replace(/'/g, "''")}')`,
    $select: 'subject,sentDateTime,toRecipients',
    $top: '100',
  });
  while (url) {
    const res = await graphFetch(url);
    if (!res.ok) throw new Error(`Sent Items lookup failed: ${res.status}`);
    const json = await res.json();
    for (const m of json.value || []) {
      if (!m.subject || m.subject.trim() !== subject) continue; // drops "[TEST] …", "Correction: …", "Re: …"
      for (const r of m.toRecipients || []) {
        const a = String(r.emailAddress?.address || '').toLowerCase();
        if (a && (!out.has(a) || m.sentDateTime > out.get(a))) out.set(a, m.sentDateTime);
      }
    }
    url = json['@odata.nextLink'] || null;
  }
  return out;
}

// The rows a real send would go to: server-recomputed eligible list, minus HR's unchecks, minus anyone already
// emailed this quarter (from the sends table or Sent Items), intersected with what the browser says is checked.
export async function resolveRecipients(employees, { empIds }) {
  const summary = buildPerformanceSummary(employees);
  const state = await getQuarterState(summary.key);
  const unchecked = new Set(state.excluded);
  const sentIds = new Set(state.sends.filter((s) => s.status === 'sent').map((s) => s.empId));
  let emailed = new Map();
  let emailedLookupError = null;
  try { emailed = await getAlreadyEmailed(summary.quarter); } catch (err) { emailedLookupError = err.message; }
  const want = new Set(empIds || []);
  const byId = new Map(employees.map((e) => [e.id, e]));
  const recipients = [];
  const skipped = [];
  for (const row of summary.groups.eligible) {
    if (!want.has(row.id)) continue;
    const recalled = isRecalled(summary.key, row.id); // a recalled email counts as not sent
    const reason = unchecked.has(row.id) ? 'excluded' : !recalled && (sentIds.has(row.id) || (row.email && emailed.has(row.email.toLowerCase()))) ? 'already sent' : !row.email ? 'no email on file' : null;
    if (reason) { skipped.push({ id: row.id, name: row.name, reason }); continue; }
    const e = byId.get(row.id);
    recipients.push({ row, to: row.email, cc: [HR_ADDRESS, getManagerEmail(e.manager, e.team)].filter(Boolean) });
  }
  return { summary, recipients, skipped, emailedLookupError };
}

// Sends the real emails: from HR@ to each CSM, CC HR@ + manager, one at a time. Each outcome is stored so a
// partial failure can be retried without re-sending to anyone who already got theirs.
export async function sendSummaryBatch(employees, { empIds }) {
  const { summary, recipients, skipped, emailedLookupError } = await resolveRecipients(employees, { empIds });
  if (emailedLookupError) throw new Error(`Could not check Sent Items for earlier ${summary.label} summaries (${emailedLookupError}) — nothing was sent, to avoid double-emailing.`);
  const db = getDb();
  await ensureTables(db);
  let sent = 0;
  const failed = [];
  for (const r of recipients) {
    try {
      await sendMail({ to: r.to, cc: r.cc, subject: summarySubject(summary.quarter), html: summaryEmailHtml(r.row, summary.quarter), sendAs: HR_ADDRESS });
      sent++;
      await db.execute({ sql: `INSERT INTO perf_summary_sends (quarter_key, emp_id, email, status, error, sent_at) VALUES (?, ?, ?, 'sent', NULL, ?) ON CONFLICT(quarter_key, emp_id) DO UPDATE SET status = 'sent', error = NULL, sent_at = excluded.sent_at`, args: [summary.key, r.row.id, r.to, new Date().toISOString()] });
    } catch (err) {
      failed.push({ id: r.row.id, name: r.row.name, error: err.message });
      await db.execute({ sql: `INSERT INTO perf_summary_sends (quarter_key, emp_id, email, status, error, sent_at) VALUES (?, ?, ?, 'error', ?, ?) ON CONFLICT(quarter_key, emp_id) DO UPDATE SET status = 'error', error = excluded.error, sent_at = excluded.sent_at`, args: [summary.key, r.row.id, r.to, String(err.message).slice(0, 400), new Date().toISOString()] });
    }
  }
  if (sent > 0 && failed.length === 0) {
    await db.execute({ sql: `INSERT INTO perf_summary_quarters (quarter_key, batch_sent_at, sent_count) VALUES (?, ?, ?) ON CONFLICT(quarter_key) DO UPDATE SET batch_sent_at = excluded.batch_sent_at, sent_count = COALESCE(perf_summary_quarters.sent_count, 0) + excluded.sent_count`, args: [summary.key, new Date().toISOString(), sent] });
  }
  return { sent, failed, skipped };
}

// ---- reminder ----
async function sendReminder(q, { to, cc }) {
  await sendMail({ to, cc, subject: reminderSubject(q), html: reminderHtml(process.env.APP_BASE_URL) });
}

// Cron entry point (feed "perfsummaryreminder"): runs on the 5th of Feb/May/Aug/Nov. Skips when it's not that day,
// when the reminder already went for the quarter, or when the summary has already been sent.
export async function sendPerformanceSummaryReminder({ force = false } = {}) {
  const today = istToday();
  const q = quarterOf(today);
  if (!force && !isReminderDay(today)) return { message: `Not the reminder day (${today}) — nothing to send.` };
  const db = getDb();
  await ensureTables(db);
  const state = await getQuarterState(quarterKey(q));
  if (state.batchSentAt) return { message: `${quarterLabel(q)} summary already sent — no reminder needed.` };
  if (state.reminderSentAt && !force) return { message: `${quarterLabel(q)} reminder already sent on ${state.reminderSentAt}.` };
  await sendReminder(q, { to: REMINDER_TO, cc: REMINDER_CC });
  await db.execute({ sql: `INSERT INTO perf_summary_quarters (quarter_key, reminder_sent_at) VALUES (?, ?) ON CONFLICT(quarter_key) DO UPDATE SET reminder_sent_at = excluded.reminder_sent_at`, args: [quarterKey(q), new Date().toISOString()] });
  return { message: `Sent the ${quarterLabel(q)} performance-summary reminder to ${REMINDER_TO} (cc ${REMINDER_CC}).` };
}
