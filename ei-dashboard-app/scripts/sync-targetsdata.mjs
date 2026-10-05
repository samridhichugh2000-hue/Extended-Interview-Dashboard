// Syncs each Sales employee's quarter target (Koenig "Get Targets Data") into
// employees.quarter_target_amount/name/year for the target quarter (see
// TARGET_QUARTER_OVERRIDE in lib/paAlgo.js). Thin wrapper over
// syncTargetsData in lib/syncRunners.js so the Windows task and the Vercel
// route run the same code.
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncTargetsData } = await import('../lib/syncRunners.js');
console.log((await syncTargetsData()).message);
