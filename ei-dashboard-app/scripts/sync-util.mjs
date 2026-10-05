// Syncs Trainer utilization into employees.metric1..metric6 (trailing six
// calendar months of utilization %) and util_monthly_details (13 months with
// the SC / Non-SC hours and the resulting utilization).
//
// Utilization = SC util + Non-SC util capped at 15% — see lib/utilization.js.
// Source: Koenig's "Trainer Utilization Hours SC / NonSC" API, one call per
// trainer per month. Thin wrapper over syncUtil in lib/syncRunners.js so the
// Windows task and the Vercel route run the same code.
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncUtil } = await import('../lib/syncRunners.js');
console.log((await syncUtil()).message);
