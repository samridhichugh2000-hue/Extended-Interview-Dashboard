// Manual CLI runner for the Sales Pipeline sync — thin wrapper around
// lib/syncRunners.js's syncPipeline (same pattern as sync-graph-meetings.mjs
// and sync-targetsdata.mjs). Meant for the local Windows Task
// (scripts/sync-all.mjs) — ~100+ Sales employees at a strict ~3s+ per call
// takes several minutes, too slow for the Vercel route's 60s limit.
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { syncPipeline } = await import('../lib/syncRunners.js');
const result = await syncPipeline();
console.log(result.message);
