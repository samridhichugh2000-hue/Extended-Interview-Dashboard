// Manual CLI runner for the External Email Count sync — thin wrapper around
// lib/syncRunners.js's syncExternalEmails (same pattern as
// sync-graph-meetings.mjs).
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncExternalEmails } = await import('../lib/syncRunners.js');
const result = await syncExternalEmails();
console.log(result.message);
