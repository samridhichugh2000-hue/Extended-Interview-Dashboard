// Syncs interviews created per recruiter (last 30 days) from the Koenig
// common API (apikey 468) into employees.recruiter_interviews_count/
// recruiter_interviews_details. Matched by emp code.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncRecruiterInterviews } = await import('../lib/syncRunners.js');
const result = await syncRecruiterInterviews();
console.log(result.message);
