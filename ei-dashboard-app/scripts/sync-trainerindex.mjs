// Saves this month's Trainer Index score for every employee in Koenig's feed into
// employees.trainer_index_details — see saveIndexHistory in lib/syncRunners.js.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncTrainerIndex } = await import('../lib/syncRunners.js');
console.log((await syncTrainerIndex()).message);
process.exit(0);
