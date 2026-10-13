// Syncs Trainer tech calls from the Koenig "Trainer Tech Calls by EmpCode" API
// into employees.tech_calls_converted (+ tech_calls_converted_details, one
// dated record per call) — see syncTechCallsTrainer in lib/syncRunners.js,
// which this just runs.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncTechCallsTrainer } = await import('../lib/syncRunners.js');
const result = await syncTechCallsTrainer();
console.log(result.message);
process.exit(0);
