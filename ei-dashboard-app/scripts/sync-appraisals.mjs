// Syncs the last two appraisals per Sales/Trainer employee into
// employees.appraisal_details — see syncAppraisals in lib/syncRunners.js,
// which this just runs.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncAppraisals } = await import('../lib/syncRunners.js');
const result = await syncAppraisals();
console.log(result.message);
process.exit(0);
