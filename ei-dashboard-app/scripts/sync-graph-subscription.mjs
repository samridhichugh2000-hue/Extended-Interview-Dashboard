// Manual CLI runner for creating/renewing the callRecords webhook
// subscription — thin wrapper around lib/syncRunners.js's
// syncGraphSubscription. Run this once to bootstrap the subscription, then
// point an external scheduler (cron-job.org, same as the other non-Vercel-
// cron feeds) at /api/sync/graphsubscription at least daily so it keeps
// renewing before the ~70h expiry.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncGraphSubscription } = await import('../lib/syncRunners.js');
const result = await syncGraphSubscription();
console.log(result.message);
