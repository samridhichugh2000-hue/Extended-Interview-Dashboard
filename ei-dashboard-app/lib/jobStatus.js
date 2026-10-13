import { getDb } from './db.js';

// Self-migrating: TURSO_DATABASE_URL/TURSO_AUTH_TOKEN are Sensitive env vars
// in Vercel, which are write-only — not even `vercel env pull` can read them
// back, so there's no way to run `npm run db:init` against production from
// outside the deployed app itself. CREATE TABLE IF NOT EXISTS is cheap and
// idempotent, so just ensure it inline rather than requiring a manual
// migration step this table can't otherwise get.
let ensured = false;
async function ensureTable(db) {
  if (ensured) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS job_runs (
    job TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    message TEXT,
    ran_at TEXT NOT NULL
  )`);
  ensured = true;
}

// Best-effort — a DB hiccup while recording status shouldn't mask the
// actual send result the caller is about to return. One row per job,
// overwritten each attempt (see schema.sql's job_runs comment).
export async function recordJobRun(job, ok, message) {
  try {
    const db = getDb();
    await ensureTable(db);
    await db.execute({
      sql: `INSERT INTO job_runs (job, status, message, ran_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(job) DO UPDATE SET status = excluded.status, message = excluded.message, ran_at = excluded.ran_at`,
      args: [job, ok ? 'ok' : 'error', message ?? null, new Date().toISOString()],
    });
  } catch (err) {
    console.error(`recordJobRun(${job}) failed:`, err.message);
  }
}

// Written right before a tracked job's real work starts, so a hard kill
// (Vercel's 60s function timeout, an OOM kill, anything that ends the
// process outright) leaves this row behind instead of nothing at all. A
// timeout doesn't run application code — it never reaches the route's own
// try/catch, so recordJobRun(false, ...) never fires and job_runs silently
// keeps showing whatever the last *completed* run said (2026-09-28's
// weeklyreport timeout left the dashboard showing the previous day's
// harmless "skipped, not Monday" as if nothing were wrong). getFailedJobRuns
// below treats a 'started' row that's stuck well past how long these jobs
// normally take as a probable timeout/crash.
export async function recordJobStarted(job) {
  try {
    const db = getDb();
    await ensureTable(db);
    await db.execute({
      sql: `INSERT INTO job_runs (job, status, message, ran_at) VALUES (?, 'started', NULL, ?)
            ON CONFLICT(job) DO UPDATE SET status = 'started', message = NULL, ran_at = excluded.ran_at`,
      args: [job, new Date().toISOString()],
    });
  } catch (err) {
    console.error(`recordJobStarted(${job}) failed:`, err.message);
  }
}

// These jobs normally finish in low single-digit to low tens of seconds —
// well under Vercel's 60s function limit — so a row still sitting at
// 'started' this long after it began almost certainly means the run never
// reached its own recordJobRun(ok/error) call at all.
const STALE_STARTED_MINUTES = 5;

// The failed ones, plus any 'started' row stuck past STALE_STARTED_MINUTES
// (a likely timeout/crash the route's own try/catch never got to record) —
// that's everything the dashboard banner needs to not go silent on a hard
// kill.
export async function getFailedJobRuns() {
  try {
    const db = getDb();
    await ensureTable(db);
    const res = await db.execute("SELECT job, status, message, ran_at FROM job_runs WHERE status = 'error' OR status = 'started'");
    const staleCutoff = Date.now() - STALE_STARTED_MINUTES * 60000;
    // libsql's res.rows are Proxy-backed Row objects, not plain objects —
    // passed straight through to the DashboardClient Client Component prop,
    // Next.js's RSC serialization silently breaks and hydration never
    // completes (no click/state update anywhere on the page works). Map to
    // real plain objects immediately, before any filtering/derivation.
    const plainRows = res.rows.map((r) => ({ job: r.job, status: r.status, message: r.message, ran_at: r.ran_at }));
    return plainRows
      .filter((r) => r.status === 'error' || new Date(r.ran_at).getTime() < staleCutoff)
      .map((r) => (r.status === 'started'
        ? { ...r, message: `Started at ${r.ran_at} but never finished — likely timed out or crashed mid-run.` }
        : r));
  } catch (err) {
    console.error('getFailedJobRuns failed:', err.message);
    return [];
  }
}

// ---- per-feed freshness (powers the "i" data-sync panel on the dashboard) ----
// One row per data feed, overwritten on every run, written by BOTH the local
// full-sync script (scripts/sync-all.mjs) and the Vercel sync route. Feed keys
// are normalised (lowercase, letters/digits only) so "inhouse-skills" (script)
// and "inhouseskills" (route) land on the same row.
export const normalizeFeedKey = (s) => String(s).toLowerCase().replace(/^sync-/, '').replace(/\.mjs$/, '').replace(/[^a-z0-9]/g, '');

async function ensureFeedTable(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS feed_runs (
    feed TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    message TEXT,
    ran_at TEXT NOT NULL,
    last_ok_at TEXT
  )`);
}

export async function recordFeedRun(feed, ok, message) {
  try {
    const db = getDb();
    await ensureFeedTable(db);
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO feed_runs (feed, status, message, ran_at, last_ok_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(feed) DO UPDATE SET status = excluded.status, message = excluded.message, ran_at = excluded.ran_at,
              last_ok_at = CASE WHEN excluded.status = 'ok' THEN excluded.ran_at ELSE feed_runs.last_ok_at END`,
      args: [normalizeFeedKey(feed), ok ? 'ok' : 'error', message ? String(message).slice(0, 300) : null, now, ok ? now : null],
    });
  } catch (err) {
    console.error(`recordFeedRun(${feed}) failed:`, err.message);
  }
}

export async function getFeedRuns() {
  try {
    const db = getDb();
    await ensureFeedTable(db);
    const res = await db.execute('SELECT feed, status, message, ran_at, last_ok_at FROM feed_runs ORDER BY feed');
    // plain objects — libsql Row proxies break RSC serialization (see above)
    return res.rows.map((r) => ({ feed: r.feed, status: r.status, message: r.message, ran_at: r.ran_at, last_ok_at: r.last_ok_at }));
  } catch (err) {
    console.error('getFeedRuns failed:', err.message);
    return [];
  }
}
