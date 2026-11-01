// Saves this month's DM Index score for every employee in Koenig's feed into
// employees.dm_index_details — see saveIndexHistory in lib/syncRunners.js.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncDmIndex } = await import('../lib/syncRunners.js');
console.log((await syncDmIndex()).message);
process.exit(0);
