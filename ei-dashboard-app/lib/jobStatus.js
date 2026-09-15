import { getDb } from './db';

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

// Only the failed ones — that's all the dashboard banner needs.
export async function getFailedJobRuns() {
  try {
    const db = getDb();
    await ensureTable(db);
    const res = await db.execute("SELECT job, status, message, ran_at FROM job_runs WHERE status = 'error'");
    return res.rows;
  } catch (err) {
    console.error('getFailedJobRuns failed:', err.message);
    return [];
  }
}
