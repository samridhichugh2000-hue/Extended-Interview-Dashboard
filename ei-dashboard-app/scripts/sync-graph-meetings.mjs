// Manual CLI runner for the Graph API Calls attendance sync — thin wrapper
// around lib/syncRunners.js's syncGraphMeetings (unlike the other sync-*.mjs
// scripts, which predate syncRunners.js and duplicate its logic standalone).
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncGraphMeetings } = await import('../lib/syncRunners.js');
const result = await syncGraphMeetings();
console.log(result.message);
