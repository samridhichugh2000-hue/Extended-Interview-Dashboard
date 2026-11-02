// Saves this month's Trainer Index score for every employee in Koenig's feed into
// employees.trainer_index_details — see saveIndexHistory in lib/syncRunners.js.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncTrainerIndex } = await import('../lib/syncRunners.js');
console.log((await syncTrainerIndex()).message);
// Give open sockets a moment to close — exiting while one is mid-close crashes Node on Windows (libuv assertion),
// which sync-all records as a failed feed even though the sync itself finished.
await new Promise((resolve) => setTimeout(resolve, 500));
process.exit(0);
