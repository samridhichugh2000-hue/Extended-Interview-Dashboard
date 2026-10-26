// Low-activity days sync (RMS clicks / emails sent / meetings attended) — see
// lib/lowActivity.js. Local-only on purpose: NOT in SYNC_RUNNERS or sync-all, so
// the Vercel cron route can never trigger it. First run covers the last 6
// months; later runs only add the days since the last run (a weekly top-up).
//   node scripts/sync-lowactivity.mjs [--dry] [--full]
// Credentials: KOENIG_RMS_API_USERNAME/PASSWORD/ROLE and KOENIG_LEAVE_API_USERNAME/PASSWORD/ROLE
// (or RMS_USER/RMS_PASS and LEAVE_USER/LEAVE_PASS for a one-off run).
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });
const e = process.env;
const { syncLowActivity } = await import('../lib/lowActivity.js');
const result = await syncLowActivity({
  dry: process.argv.includes('--dry'),
  full: process.argv.includes('--full'), // recompute the whole window from scratch
  cachePath: e.LOW_ACTIVITY_CACHE,
  creds: {
    rms: { userName: e.KOENIG_RMS_API_USERNAME || e.RMS_USER, userPassword: e.KOENIG_RMS_API_PASSWORD || e.RMS_PASS, userRole: e.KOENIG_RMS_API_ROLE || 'RMS Activity Report' },
    leave: { userName: e.KOENIG_LEAVE_API_USERNAME || e.LEAVE_USER, userPassword: e.KOENIG_LEAVE_API_PASSWORD || e.LEAVE_PASS, userRole: e.KOENIG_LEAVE_API_ROLE || 'Get Employee Leave Details' },
  },
});
console.log(result.message);
