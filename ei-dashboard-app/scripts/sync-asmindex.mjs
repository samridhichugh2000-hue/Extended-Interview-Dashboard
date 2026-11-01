// Saves this month's ASM Index score for every employee in Koenig's feed into
// employees.asm_index_details — see saveIndexHistory in lib/syncRunners.js.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncAsmIndex } = await import('../lib/syncRunners.js');
console.log((await syncAsmIndex()).message);
process.exit(0);
