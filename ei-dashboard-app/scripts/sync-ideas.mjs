// Syncs Non-RMS Tasks By EmpID from Koenig into employees.ideas_count/
// ideas_details, across all three teams — feeds the "Ideas for improvement"
// Worry Index signal. Per-employee API, one call per employee, matched
// directly by EmpId.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getNonRmsTasks } = await import('../lib/koenigIdeasApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1");

let updated = 0;
let confirmedZero = 0;
let apiErrors = 0;
for (const emp of allEmployees.rows) {
  const empCode = emp.id.replace('EMP', '');
  try {
    const tasks = await getNonRmsTasks(empCode);
    await db.execute({
      sql: 'UPDATE employees SET ideas_count = ?, ideas_details = ? WHERE id = ?',
      args: [tasks.length, JSON.stringify(tasks), emp.id],
    });
    if (tasks.length) updated++; else confirmedZero++;
  } catch (err) {
    console.error(`Ideas sync failed for ${emp.id}:`, err.message);
    apiErrors++;
  }
}

console.log(`Synced ideas-for-improvement tasks — ${updated} employees have at least one (${confirmedZero} confirmed at 0, ${apiErrors} API errors).`);
const check = await db.execute('SELECT id, name, team, ideas_count FROM employees WHERE ideas_count > 0 ORDER BY ideas_count DESC');
for (const r of check.rows) console.log(' ', r.id, r.name, r.team, r.ideas_count);
