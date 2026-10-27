// Blue-collar staff (office boy, cook, driver…) must not appear on the dashboard,
// but Koenig only tags some of them "Blue Collared" — the rest arrive filed under
// a normal department (usually PT Team). Two ways they are kept out:
//   - EXCLUDED_EMP_IDS + the excluded_employees table: ids the new-joiner sync
//     (syncKoenig) must never re-add after they've been deleted.
//   - BLUE_COLLAR_DESIGNATIONS: exact designations (case-insensitive) that the
//     employee-details sync recognises and removes. Exact matches only, so a
//     "Device Driver Developer" or "Executive Assistant" is never caught.
export const EXCLUDED_EMP_IDS = new Set([
  'EMP4921', // Karan Kumar — Office Boy (removed 2026-10-27)
]);

export const BLUE_COLLAR_DESIGNATIONS = new Set([
  'office boy', 'office assistant', 'cook', 'care taker', 'caretaker', 'gardener', 'driver',
  'yoga trainer', 'peon', 'security guard', 'housekeeping', 'housekeeper', 'sweeper', 'watchman',
]);
export const isBlueCollarDesignation = (d) => BLUE_COLLAR_DESIGNATIONS.has(String(d || '').trim().toLowerCase());

// Every table that holds rows keyed by employee_id, deleted along with the employee.
const LINKED_TABLES = [
  'pip_status', 'hr_incidents', 'manager_feedback', 'weekly_responses', 'graph_meetings',
  'ei_index_snapshots', 'unreplied_emails', 'unreplied_lists_saved', 'video_meetings',
  'email_thread_verdicts', 'employee_monthly_history',
];

async function ensureExcludedTable(db) {
  await db.execute('CREATE TABLE IF NOT EXISTS excluded_employees (employee_id TEXT PRIMARY KEY, reason TEXT, excluded_at TEXT NOT NULL)');
}

// Ids the new-joiner sync must skip: the code list plus everything removed before.
export async function loadExcludedIds(db) {
  await ensureExcludedTable(db);
  const rows = (await db.execute('SELECT employee_id FROM excluded_employees')).rows;
  return new Set([...EXCLUDED_EMP_IDS, ...rows.map((r) => r.employee_id)]);
}

// Deletes the employees and their linked rows, and remembers the ids so the sync
// does not bring them back. ids: ['EMP123', ...]; reason: free text.
export async function removeEmployees(db, ids, reason) {
  if (!ids.length) return 0;
  await ensureExcludedTable(db);
  const now = new Date().toISOString();
  const stmts = [];
  for (const id of ids) {
    for (const t of LINKED_TABLES) stmts.push({ sql: `DELETE FROM ${t} WHERE employee_id = ?`, args: [id] });
    stmts.push({ sql: 'DELETE FROM employees WHERE id = ?', args: [id] });
    stmts.push({ sql: 'INSERT OR REPLACE INTO excluded_employees (employee_id, reason, excluded_at) VALUES (?, ?, ?)', args: [id, reason, now] });
  }
  await db.batch(stmts, 'write');
  return ids.length;
}
