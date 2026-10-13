// Syncs "True NR" (old Get Employee NR API, net of salary and marketing cost)
// into employees.true_nr_details for active Sales employees — see syncTrueNr
// in lib/syncRunners.js, which this just runs.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncTrueNr } = await import('../lib/syncRunners.js');
const result = await syncTrueNr();
console.log(result.message);
process.exit(0);
