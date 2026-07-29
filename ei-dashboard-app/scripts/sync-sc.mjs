// Syncs SCs (service contracts) raised from the Koenig "List CSM SC List"
// API into employees.sc_raised / sc_details, Sales team only. Unlike the
// enquiry audit feed, this one carries the employee code directly, so
// matching is a plain id lookup, no fuzzy name matching required.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getScList } = await import('../lib/koenigScListApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Go wide — an NJ's SCs can span their whole tenure to date, not just a
// recent window, and the feed is cheap to fetch in one call regardless.
const rows = await getScList('2020-01-01', '2030-01-01');

const byEmpCode = new Map();
for (const r of rows) {
  if (!byEmpCode.has(r.empCode)) byEmpCode.set(r.empCode, []);
  byEmpCode.get(r.empCode).push(r);
}

const salesEmployees = await db.execute("SELECT id, tenure_days FROM employees WHERE team = 'Sales'");

// Emp codes get recycled — e.g. one current NJ's code has SC rows dating back
// to 2021, years before they joined. Reconstruct each employee's join date
// from tenure_days and only count SCs raised on/after it, so a reused code's
// prior occupant doesn't inflate this NJ's count.
function joinDate(tenureDays) {
  const d = new Date();
  d.setDate(d.getDate() - tenureDays);
  d.setHours(0, 0, 0, 0);
  return d;
}

let updated = 0;
let unmatched = 0;
let excludedPreJoin = 0;
for (const emp of salesEmployees.rows) {
  const empCode = parseInt(emp.id.replace('EMP', ''), 10);
  const since = joinDate(emp.tenure_days);
  const all = byEmpCode.get(empCode) || [];
  const scs = all.filter((s) => new Date(s.createdOn) >= since).sort((a, b) => new Date(b.createdOn) - new Date(a.createdOn));
  excludedPreJoin += all.length - scs.length;
  if (!scs.length) { unmatched++; continue; }

  const details = scs.map((s) => ({ scId: s.scId, createdOn: s.createdOn, status: s.status, quotationStatus: s.quotationStatus }));
  await db.execute({
    sql: 'UPDATE employees SET sc_raised = ?, sc_details = ? WHERE id = ?',
    args: [scs.length, JSON.stringify(details), emp.id],
  });
  updated++;
}

console.log(`Synced SC data for ${updated} Sales employees (${unmatched} had no matching SC rows; ${excludedPreJoin} pre-join SC rows excluded as recycled-emp-code noise).`);
const check = await db.execute("SELECT id, name, sc_raised FROM employees WHERE team = 'Sales' ORDER BY sc_raised DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.sc_raised);
