// Syncs Sales net-revenue (NR) from Koenig's "Get Employee NR Without Salary and
// Marketing Cost" API into employees.metric1..metric6 (trailing six calendar
// months), nr_monthly_details and nr_future_details. Thin wrapper over
// syncPms in lib/syncRunners.js so the Windows task and the Vercel route run
// the same code.
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncPms } = await import('../lib/syncRunners.js');
console.log((await syncPms()).message);
