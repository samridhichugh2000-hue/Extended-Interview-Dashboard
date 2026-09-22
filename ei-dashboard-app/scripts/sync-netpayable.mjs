// Syncs Net Payable Details (payroll) from Koenig into employees.
// net_payable_month / net_payable_details, across all three teams.
// StartDate/EndDate must fall within the same calendar month (undocumented
// API constraint — see lib/koenigNetPayableApi.js), so this tries the
// current month first and falls back one month if payroll for the current
// month hasn't run yet.
//
// This is a data sync only — nothing in the UI reads net_payable_details.
// Deliberately does not print salary figures to the console; only coverage
// counts.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getNetPayable } = await import('../lib/koenigNetPayableApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function monthRange(monthsAgo) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  const year = d.getFullYear();
  const month = d.getMonth();
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    key: `${year}-${pad(month + 1)}`,
    start: `${year}-${pad(month + 1)}-01`,
    end: `${year}-${pad(month + 1)}-${pad(lastDay)}`,
  };
}

const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1");

let updated = 0;
let unmatched = 0;
let apiErrors = 0;
for (const emp of allEmployees.rows) {
  const empCode = emp.id.replace('EMP', '');
  try {
    let month = monthRange(0);
    let row = await getNetPayable(empCode, month.start, month.end);
    if (!row) { month = monthRange(1); row = await getNetPayable(empCode, month.start, month.end); }
    if (!row) { unmatched++; continue; }

    await db.execute({
      sql: 'UPDATE employees SET net_payable_month = ?, net_payable_details = ? WHERE id = ?',
      args: [month.key, JSON.stringify(row), emp.id],
    });
    updated++;
  } catch (err) {
    console.error(`Net payable sync failed for ${emp.id}:`, err.message);
    apiErrors++;
  }
}

console.log(`Synced net payable details for ${updated} employees (${unmatched} had no payroll record for this or last month, ${apiErrors} API errors).`);
