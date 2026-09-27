// Syncs Koenig "Get Employee Details (PMS)" into employees.country/
// emp_city/emp_state/is_overseas/designation, Sales/CSMs and Trainers —
// used to identify India-based CSMs for PA Algo's salary-multiple criteria,
// and to identify Trainer K11 designations for the Trainer PA Algo criteria.
// Nothing else from the raw response (bank account, IFSC, UAN, personal
// phone, home address) is kept — see lib/koenigEmployeeDetailsApi.js.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getEmployeeDetails } = await import('../lib/koenigEmployeeDetailsApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer') AND active = 1");

let updated = 0;
let unmatched = 0;
let apiErrors = 0;
for (const emp of allEmployees.rows) {
  const empCode = emp.id.replace('EMP', '');
  try {
    const details = await getEmployeeDetails(empCode);
    if (!details) { unmatched++; continue; }

    await db.execute({
      sql: 'UPDATE employees SET country = ?, emp_city = ?, emp_state = ?, is_overseas = ?, designation = ? WHERE id = ?',
      args: [details.countryName, details.cityName, details.stateName, details.isOverseas ? 1 : 0, details.designationName, emp.id],
    });
    updated++;
  } catch (err) {
    console.error(`Employee details sync failed for ${emp.id}:`, err.message);
    apiErrors++;
  }
}

console.log(`Synced employee details for ${updated} employees (${unmatched} had no record, ${apiErrors} API errors).`);
