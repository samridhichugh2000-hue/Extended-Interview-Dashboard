// One-off: graph_meetings rows synced before client_emails existed have it
// NULL, which the dashboard treats as "internal only". Re-read those
// employees' calendars for the affected dates and fill client_emails in
// (external = anyone outside @koenig-solutions.com among organizer/attendees),
// so the external-only meeting rule doesn't wrongly drop real client meetings.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const { getCalendarTeamsMeetings, parseGraphDateTime } = await import('../lib/graphCallsApi.js');
const { isExternalAddress } = await import('../lib/graphMailer.js');
const { recomputeGraphAggregates } = await import('../lib/syncRunners.js');

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const emps = await db.execute(`SELECT e.id, e.email, min(g.scheduled_start) AS first, max(g.scheduled_start) AS last
  FROM graph_meetings g JOIN employees e ON e.id = g.employee_id
  WHERE g.client_emails IS NULL GROUP BY e.id, e.email`);

let filled = 0, notFound = 0, errors = 0;
for (const emp of emps.rows) {
  if (!emp.email) continue;
  const from = new Date(new Date(emp.first).getTime() - 86400000).toISOString();
  const to = new Date(new Date(emp.last).getTime() + 2 * 86400000).toISOString();
  let events;
  try {
    events = await getCalendarTeamsMeetings(emp.email, from, to);
  } catch (err) {
    console.error(`calendar fetch failed for ${emp.email}:`, err.message);
    errors++;
    continue;
  }
  const byKey = new Map();
  for (const ev of events) {
    const joinUrl = ev.onlineMeeting?.joinUrl;
    const org = ev.organizer?.emailAddress?.address;
    if (!joinUrl || !org) continue;
    const participants = [org, ...(ev.attendees || []).map((a) => a.emailAddress?.address)].filter(Boolean);
    byKey.set(`${joinUrl}|${parseGraphDateTime(ev.start.dateTime).toISOString()}`, [...new Set(participants.filter(isExternalAddress).map((a) => a.toLowerCase()))]);
  }
  const rows = await db.execute({ sql: 'SELECT id, join_url, scheduled_start FROM graph_meetings WHERE employee_id = ? AND client_emails IS NULL', args: [emp.id] });
  const stmts = [];
  for (const r of rows.rows) {
    const clients = byKey.get(`${r.join_url}|${r.scheduled_start}`);
    if (clients) { stmts.push({ sql: 'UPDATE graph_meetings SET client_emails = ? WHERE id = ?', args: [JSON.stringify(clients), r.id] }); filled++; }
    else notFound++;
  }
  if (stmts.length) await db.batch(stmts, 'write');
}
console.log(`Backfilled client_emails on ${filled} meetings (${notFound} no longer on the calendar, ${errors} calendar errors).`);
process.exit(0);
