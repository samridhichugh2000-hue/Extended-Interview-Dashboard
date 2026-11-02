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
// Give open sockets a moment to close — exiting while one is mid-close crashes Node on Windows (libuv assertion),
// which sync-all records as a failed feed even though the sync itself finished.
await new Promise((resolve) => setTimeout(resolve, 500));
process.exit(0);
