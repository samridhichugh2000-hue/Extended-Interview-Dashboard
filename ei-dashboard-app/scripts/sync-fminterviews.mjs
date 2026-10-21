// Syncs interviews scheduled per FM (last 30 days) from the Outreach
// Dashboard's scheduled-calls API into employees.fm_interviews_count/
// fm_interviews_details. Matched by email. An FM the API doesn't list has
// no interviews in the window, so is written as a genuine 0.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncFmInterviews } = await import('../lib/syncRunners.js');
const result = await syncFmInterviews();
console.log(result.message);
