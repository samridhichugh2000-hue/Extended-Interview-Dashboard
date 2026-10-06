import fs from 'fs';
import { createClient } from '@libsql/client';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const weeks = await db.execute('SELECT week, COUNT(*) as c FROM weekly_responses GROUP BY week ORDER BY week DESC LIMIT 6');
console.log('Weeks with data:', weeks.rows);

const recentWeeks = weeks.rows.slice(0, 2).map((r) => r.week);
console.log('\nFetching:', recentWeeks);

const rows = await db.execute({
  sql: `SELECT wr.week, wr.state, wr.sent_at, wr.received_at, wr.q1, wr.a1, wr.q2, wr.a2, e.name, e.team, e.status, e.tenure_days
        FROM weekly_responses wr JOIN employees e ON e.id = wr.employee_id
        WHERE wr.week IN (${recentWeeks.map(() => '?').join(',')})
        ORDER BY wr.week DESC, e.team ASC, e.name ASC`,
  args: recentWeeks,
});

for (const r of rows.rows) {
  console.log('====================================');
  console.log(`${r.week} | ${r.name} (${r.team}, ${r.status}, tenure ${r.tenure_days}d) | state: ${r.state}`);
  console.log(`Q1: ${r.q1}`);
  console.log(`A1: ${r.a1 || '(no answer)'}`);
  console.log(`Q2: ${r.q2}`);
  console.log(`A2: ${r.a2 || '(no answer)'}`);
}
console.log(`\nTotal rows: ${rows.rows.length}`);
