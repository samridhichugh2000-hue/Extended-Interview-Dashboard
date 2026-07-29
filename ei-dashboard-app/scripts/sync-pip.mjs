// Syncs PA/PIP incidents from the Koenig "GetIncidentData" API into pip_status,
// and reflects the current case (if any) onto employees.status/hr_note.
// Only touches employees already present (synced from New Joiners) — an
// incident for someone outside that set is skipped rather than force-inserted.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getPipPanelData } = await import('../lib/koenigPipApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function displayDate(raw) {
  // Koenig sends FromDate/ToDate already as "1 Apr 2026" style strings.
  return raw || '—';
}

const rows = await getPipPanelData('2020-01-01', '2030-01-01');

const existing = await db.execute('SELECT id FROM employees');
const knownIds = new Set(existing.rows.map((r) => r.id));

const byEmployee = new Map();
for (const r of rows) {
  const employeeId = 'EMP' + r.empCode;
  if (!knownIds.has(employeeId)) continue; // outside the tracked NJ roster
  if (!byEmployee.has(employeeId)) byEmployee.set(employeeId, []);
  byEmployee.get(employeeId).push(r);
}

let updated = 0;
for (const [employeeId, incidents] of byEmployee) {
  // Prefer the current open case; among several, the most recently created.
  incidents.sort((a, b) => new Date(b.createdOn) - new Date(a.createdOn));
  const current = incidents.find((i) => i.isActive) || null;

  await db.execute({ sql: 'DELETE FROM pip_status WHERE employee_id = ?', args: [employeeId] });
  for (const i of incidents) {
    await db.execute({
      sql: `INSERT INTO pip_status (employee_id, type, issued_on, review_by, breaches, comment, is_active, source_id)
            VALUES (?, ?, ?, ?, '[]', ?, ?, ?)`,
      args: [employeeId, i.type, displayDate(i.fromDate), displayDate(i.toDate), i.comment, i.isActive ? 1 : 0, i.sourceId],
    });
  }

  const status = current ? (current.type === 'PIP' ? 'PIP Issued' : 'PA Issued') : 'In Progress';
  await db.execute({
    sql: 'UPDATE employees SET status = ?, hr_note = ? WHERE id = ?',
    args: [status, current ? current.comment : null, employeeId],
  });
  updated++;
}

console.log(`Synced ${rows.length} incidents; ${byEmployee.size} matched tracked employees; ${updated} employee records updated.`);
const check = await db.execute("SELECT id, name, status FROM employees WHERE status != 'In Progress' ORDER BY status");
for (const row of check.rows) console.log(' ', row.id, row.name, row.status);
