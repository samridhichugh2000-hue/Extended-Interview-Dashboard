// Syncs the Enquiry Audit Report into employees.neg_audits (count of
// below-satisfactory audits), Sales team only. The audit API has no employee
// code — rows are matched to employees by fuzzy name comparison.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getEnquiryAudits, isNegativeRating } = await import('../lib/koenigEnquiryAuditApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

// Matches if the employee's first and last name tokens both appear
// somewhere in the audit row's CSM name (handles middle names, nicknames,
// case differences — e.g. "Ivan Mathebula" vs "Ivan Jonathan Mathebula").
function namesMatch(employeeName, csmName) {
  const empTokens = normalize(employeeName);
  const csmTokens = new Set(normalize(csmName));
  if (empTokens.length === 0) return false;
  return csmTokens.has(empTokens[0]) && csmTokens.has(empTokens[empTokens.length - 1]);
}

// Audits can predate a NJ's tenure window (an audit logged before the person
// even joined would be a data error, but there's no reason to assume the
// upstream system's date range lines up with ours) — go wide rather than
// silently miss real matches the way a 6-month cutoff would.
const audits = await getEnquiryAudits('2020-01-01', '2030-01-01');
const salesEmployees = await db.execute("SELECT id, name FROM employees WHERE team = 'Sales'");

let updated = 0;
let unmatched = 0;
for (const emp of salesEmployees.rows) {
  const matches = audits.filter((a) => namesMatch(emp.name, a.csmName));
  if (!matches.length) { unmatched++; continue; }

  const negatives = matches.filter((a) => isNegativeRating(a.rating));
  const remarks = negatives.map((a) => ({
    createdOn: a.createdOn,
    rating: a.rating,
    remark: a.remark,
    enquiryId: a.enquiryId,
    clientEmail: a.clientEmail,
  }));
  await db.execute({
    sql: 'UPDATE employees SET neg_audits = ?, audit_remarks = ? WHERE id = ?',
    args: [negatives.length, JSON.stringify(remarks), emp.id],
  });
  updated++;
}

console.log(`Synced audit data for ${updated} Sales employees (${unmatched} had no matching audit rows).`);
const check = await db.execute("SELECT id, name, neg_audits FROM employees WHERE team = 'Sales' ORDER BY neg_audits DESC");
for (const r of check.rows) console.log(' ', r.id, r.name, r.neg_audits);
