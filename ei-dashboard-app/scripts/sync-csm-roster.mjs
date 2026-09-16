// Syncs shift data from the Koenig "Get CSM Roster" API into
// employees.roster_count/roster_details, Sales team only. Carries the
// employee code directly, same as the SC List feed, so matching is a plain
// id lookup, no fuzzy name matching required.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getCsmRoster } = await import('../lib/koenigCsmRosterApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const rows = await getCsmRoster();
const byEmpCode = new Map();
for (const r of rows) {
  if (!byEmpCode.has(r.empCode)) byEmpCode.set(r.empCode, []);
  byEmpCode.get(r.empCode).push(r);
}

const salesEmployees = await db.execute("SELECT id FROM employees WHERE team = 'Sales'");

const statements = [];
let updated = 0;
let unmatched = 0;
for (const emp of salesEmployees.rows) {
  const empCode = parseInt(emp.id.replace('EMP', ''), 10);
  const shifts = (byEmpCode.get(empCode) || []).sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
  if (!shifts.length) { unmatched++; continue; }

  const details = shifts.map((s) => ({ startDate: s.startDate, startTime: s.startTime, endDate: s.endDate, endTime: s.endTime }));
  statements.push({
    sql: 'UPDATE employees SET roster_count = ?, roster_details = ? WHERE id = ?',
    args: [shifts.length, JSON.stringify(details), emp.id],
  });
  updated++;
}

if (statements.length) await db.batch(statements, 'write');

console.log(`Synced CSM Roster data for ${updated} Sales employees (${unmatched} unmatched).`);
const check = await db.execute("SELECT id, name, roster_count FROM employees WHERE team = 'Sales' ORDER BY roster_count DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.roster_count);
