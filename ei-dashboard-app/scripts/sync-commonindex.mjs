// Syncs Common Index (TotalPoint) from Koenig into employees.common_index_points,
// across all three teams. Per-employee lookup only (no bulk mode) — see
// lib/koenigCommonIndexApi.js.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getCommonIndexPoints } = await import('../lib/koenigCommonIndexApi.js');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const allEmployees = await db.execute("SELECT id FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1");

// Bounded concurrency — a plain sequential loop over ~500 employees at
// ~300ms/call takes minutes; this mirrors lib/syncRunners.js's syncCommonIndex.
const CONCURRENCY = 20;
async function mapWithConcurrency(items, limit, fn) {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

let updated = 0;
let apiErrors = 0;
await mapWithConcurrency(allEmployees.rows, CONCURRENCY, async (emp) => {
  const empCode = emp.id.replace('EMP', '');
  try {
    const points = await getCommonIndexPoints(empCode);
    if (points == null) return;
    await db.execute({
      sql: 'UPDATE employees SET common_index_points = ? WHERE id = ?',
      args: [points, emp.id],
    });
    updated++;
  } catch (err) {
    console.error(`Common Index sync failed for ${emp.id}:`, err.message);
    apiErrors++;
  }
});

console.log(`Synced Common Index points for ${updated} employees (${apiErrors} API errors).`);
