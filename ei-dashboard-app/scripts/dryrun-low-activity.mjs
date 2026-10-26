// DRY RUN of the low-activity-days check: reads RMS, Outlook Sent Items, the
// stored Teams call records and the leave feed, prints how many days would be
// flagged — and writes NOTHING to Turso. Credentials come from the environment:
//   RMS_USER RMS_PASS  LEAVE_USER LEAVE_PASS  node scripts/dryrun-low-activity.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });
const { getDb } = await import('../lib/db.js');
const L = await import('../lib/lowActivity.js');

const days = L.workingDays();
console.log(`Window: ${days.length} working days, ${days[0]} to ${days[days.length - 1]} (weekends skipped)`);
const fromIso = new Date(`${days[0]}T00:00:00+05:30`).toISOString();

const emps = (await getDb().execute("SELECT id, team, email, doj FROM employees WHERE active = 1")).rows;
const num = (id) => Number(String(id).replace(/\D/g, ''));
const dojDay = (doj) => { const d = new Date(doj); return isNaN(d) ? '0000-00-00' : d.toISOString().slice(0, 10); };

const rms = await L.rmsClicksByDay(days, { userName: process.env.RMS_USER, userPassword: process.env.RMS_PASS, userRole: 'RMS Activity Report' });
console.log('RMS: done,', days.length, 'calls');
const meet = await L.meetingDays(fromIso);
console.log('Meetings: employees with any stored meeting in window:', meet.size);

const lt = await L.leaveToken({ userName: process.env.LEAVE_USER, userPassword: process.env.LEAVE_PASS, userRole: 'Get Employee Leave Details' });
let ix = 0, mailErr = 0, noMailbox = 0;
const res = [];
async function worker() {
  while (ix < emps.length) {
    const e = emps[ix++];
    const r = { id: e.id, team: e.team, evaluated: 0, lowRms: 0, noEmail: 0, noMeeting: 0, mailOk: false };
    try {
      let sent = null;
      if (e.email) { try { sent = await L.emailDaysSent(e.email, fromIso); r.mailOk = true; } catch (err) { if (err.status === 404) noMailbox++; else mailErr++; } }
      const leave = await L.approvedLeaveDays(num(e.id), lt).catch(() => new Set());
      const doj = dojDay(e.doj);
      const mine = meet.get(e.id) || new Set();
      for (const d of days) {
        if (d < doj || leave.has(d)) continue;
        r.evaluated++;
        if ((rms.get(d)?.get(num(e.id)) || 0) < L.LOW_RMS_CLICKS) r.lowRms++;
        if (sent && !sent.has(d)) r.noEmail++;
        if (!mine.has(d)) r.noMeeting++;
      }
    } catch (err) { mailErr++; }
    res.push(r);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

const sum = (a, k) => a.reduce((s, r) => s + r[k], 0);
const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '-');
const mailRows = res.filter((r) => r.mailOk);
console.log(`\nEmployees ${res.length} | mailbox ok ${mailRows.length} | no mailbox ${noMailbox} | errors ${mailErr}`);
console.log(`Employee-days evaluated: ${sum(res, 'evaluated')}`);
console.log(`Share of days flagged — RMS<${L.LOW_RMS_CLICKS} clicks: ${pct(sum(res, 'lowRms'), sum(res, 'evaluated'))} | no email sent: ${pct(sum(mailRows, 'noEmail'), sum(mailRows, 'evaluated'))} | no meeting: ${pct(sum(res, 'noMeeting'), sum(res, 'evaluated'))}`);
for (const team of [...new Set(res.map((r) => r.team))]) {
  const t = res.filter((r) => r.team === team); const tm = t.filter((r) => r.mailOk);
  console.log(`  ${team.padEnd(18)} n=${String(t.length).padEnd(4)} RMS ${pct(sum(t, 'lowRms'), sum(t, 'evaluated')).padEnd(5)} email ${pct(sum(tm, 'noEmail'), sum(tm, 'evaluated')).padEnd(5)} meeting ${pct(sum(t, 'noMeeting'), sum(t, 'evaluated'))}`);
}
const dist = (k) => { const b = { '0': 0, '1-3': 0, '4-7': 0, '8+': 0 }; for (const r of res) { const v = r[k]; b[v === 0 ? '0' : v <= 3 ? '1-3' : v <= 7 ? '4-7' : '8+']++; } return JSON.stringify(b); };
console.log('Employees by number of flagged days (0 / 1-3 / 4-7 / 8+):');
console.log('  RMS    ', dist('lowRms'));
console.log('  email  ', dist('noEmail'));
console.log('  meeting', dist('noMeeting'));
console.log('\nNothing was written to Turso.');
