// Saved copy of each employee's unreplied-email list, written by the nightly
// sync (syncUnrepliedEmails) and read by /api/outlook/unreplied so "Load
// emails" is instant instead of walking the mailbox live. Holds subject,
// sender, recipients' addresses, date, status and the AI verdict only — never
// the body or preview.
import { getDb } from './db.js';

let ensured = false;
async function ensureTable(db) {
  if (ensured) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS unreplied_emails (
    employee_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    subject TEXT,
    from_name TEXT,
    from_address TEXT,
    to_json TEXT,
    cc_json TEXT,
    received_at TEXT,
    is_read INTEGER,
    web_link TEXT,
    category TEXT,
    reason TEXT,
    PRIMARY KEY (employee_id, message_id)
  )`);
  await db.execute('CREATE TABLE IF NOT EXISTS unreplied_lists_saved (employee_id TEXT PRIMARY KEY, saved_at TEXT NOT NULL)');
  ensured = true;
}

// Replace this employee's saved list with the unanswered, needs-review and
// set-aside (answered / no action needed) threads.
export async function saveUnreplied(employeeId, unanswered, notNeeded, needsReview = []) {
  const db = getDb();
  await ensureTable(db);
  const stmts = [{ sql: 'DELETE FROM unreplied_emails WHERE employee_id = ?', args: [employeeId] }];
  for (const m of [...unanswered, ...needsReview, ...notNeeded]) {
    stmts.push({
      sql: `INSERT OR REPLACE INTO unreplied_emails
        (employee_id, message_id, subject, from_name, from_address, to_json, cc_json, received_at, is_read, web_link, category, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [employeeId, m.id, m.subject, m.fromName, m.fromAddress, JSON.stringify(m.to || []), JSON.stringify(m.cc || []),
        m.receivedDateTime, m.isRead ? 1 : 0, m.webLink, m.category || 'unanswered', m.categoryReason || null],
    });
  }
  stmts.push({ sql: 'INSERT OR REPLACE INTO unreplied_lists_saved (employee_id, saved_at) VALUES (?, ?)', args: [employeeId, new Date().toISOString()] });
  await db.batch(stmts, 'write');
}

// Same shape getUnrepliedThreads returns for the two lists, or null if no list
// was ever saved for this employee (an empty saved list is still a list).
export async function loadUnreplied(employeeId) {
  const db = getDb();
  await ensureTable(db);
  const saved = (await db.execute({ sql: 'SELECT 1 FROM unreplied_lists_saved WHERE employee_id = ?', args: [employeeId] })).rows[0];
  if (!saved) return null;
  const rows = (await db.execute({
    sql: 'SELECT * FROM unreplied_emails WHERE employee_id = ? ORDER BY received_at DESC', args: [employeeId],
  })).rows;
  const items = rows.map((r) => ({
    id: r.message_id, subject: r.subject || '(no subject)', fromName: r.from_name, fromAddress: r.from_address,
    to: JSON.parse(r.to_json || '[]'), cc: JSON.parse(r.cc_json || '[]'),
    receivedDateTime: r.received_at, isRead: !!r.is_read, preview: '', webLink: r.web_link,
    category: r.category, categoryReason: r.reason,
  }));
  // 'needs_response' is the label older saved lists used for what is now 'unanswered'.
  const isUnanswered = (m) => m.category === 'unanswered' || m.category === 'needs_response';
  return {
    unreplied: items.filter(isUnanswered),
    needsReview: items.filter((m) => m.category === 'needs_review'),
    notNeeded: items.filter((m) => !isUnanswered(m) && m.category !== 'needs_review'),
  };
}
