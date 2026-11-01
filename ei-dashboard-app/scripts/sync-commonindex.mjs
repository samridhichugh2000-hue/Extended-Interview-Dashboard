// Syncs Common Index (TotalPoint) from Koenig into employees.common_index_points
// and saves this month's value in employees.common_index_details, across all
// teams — thin wrapper around syncCommonIndex in lib/syncRunners.js (same as
// sync-csmindex.mjs). Per-employee lookup only; see lib/koenigCommonIndexApi.js.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncCommonIndex } = await import('../lib/syncRunners.js');
const result = await syncCommonIndex();
console.log(result.message);
process.exit(0);
