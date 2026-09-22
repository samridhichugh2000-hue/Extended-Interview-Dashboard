// Prints every 'Received' weekly_responses row that has no ai_rating yet, as
// JSON, including the employee's prior completed week's answers (for
// repetition checks). Meant to be read by a Claude Code agent (interactive
// or scheduled) that rates each one against the rubric in
// scripts/RATING_RUBRIC.md, then feeds results to save-ratings.mjs.
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const unrated = await db.execute(
  `SELECT wr.id, wr.employee_id, wr.week, wr.q1, wr.a1, wr.q2, wr.a2, e.name, e.team
   FROM weekly_responses wr JOIN employees e ON e.id = wr.employee_id
   WHERE wr.state = 'Received' AND (wr.ai_rating IS NULL OR wr.ai_rating = '')
   ORDER BY wr.week ASC, e.name ASC`
);

const out = [];
for (const r of unrated.rows) {
  const prior = await db.execute({
    sql: `SELECT a1, a2 FROM weekly_responses WHERE employee_id = ? AND state = 'Received' AND week < ? ORDER BY week DESC LIMIT 1`,
    args: [r.employee_id, r.week],
  });
  out.push({
    id: r.id,
    name: r.name,
    team: r.team,
    week: r.week,
    q1: r.q1, a1: r.a1,
    q2: r.q2, a2: r.a2,
    priorA1: prior.rows[0]?.a1 || null,
    priorA2: prior.rows[0]?.a2 || null,
  });
}

console.log(JSON.stringify(out, null, 2));
console.error(`\n${out.length} unrated response(s).`);
