// Syncs Employee Salary Details from Koenig into employees.salary/
// salary_source, Sales/CSMs and Trainers only (per instruction not to
// populate salary for anyone else — see PA Algo). Replaces sync-netpayable.
// Deliberately does not print salary figures to the console; only coverage
// counts.
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncSalary } = await import('../lib/syncRunners.js');
console.log((await syncSalary()).message);
