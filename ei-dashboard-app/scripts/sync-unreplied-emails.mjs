// Manual CLI runner for the unreplied-email counts — thin wrapper around
// lib/syncRunners.js's syncUnrepliedEmails.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncUnrepliedEmails } = await import('../lib/syncRunners.js');
const result = await syncUnrepliedEmails();
console.log(result.message);
