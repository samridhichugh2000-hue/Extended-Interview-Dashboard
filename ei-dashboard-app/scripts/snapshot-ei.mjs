// Records today's EI (Worry) Index snapshot — see lib/eiSnapshots.js. Run at
// the end of sync-all so it captures the freshly synced data.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { takeEiSnapshot } = await import('../lib/eiSnapshots.js');
const result = await takeEiSnapshot();
console.log(result.message);
process.exit(0);
