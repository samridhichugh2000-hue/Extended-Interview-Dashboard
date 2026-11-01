// Saves this month's CSM Index score for every employee in Koenig's
// "Get CSM Index Score" feed into employees.csm_index_details — see
// syncCsmIndex in lib/syncRunners.js for why this is a monthly snapshot.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncCsmIndex } = await import('../lib/syncRunners.js');
console.log((await syncCsmIndex()).message);
process.exit(0);
