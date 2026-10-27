// Adds activity rows to the Past ML snapshot (lib/pastMl.js) for each case's six
// months before the leave: Teams meetings on the calendar (Sales + Trainer) and
// tech calls (Trainer only: taken / converted). Review
// only. Writes nothing to the database: it reads 17 people's stored tech-call
// columns and each person's Outlook calendar (Microsoft Graph, read-only).
//   node scripts/add-past-ml-activity.mjs          (re-run after scripts/gen-past-ml.mjs, which rebuilds the file without these rows)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });
const { getDb } = await import('../lib/db.js');
const { getCalendarTeamsMeetings } = await import('../lib/graphCallsApi.js');
const { PAST_ML } = await import('../lib/pastMl.js');
const ym = (d) => String(d || '').slice(0, 7);
const { getTrainerTechCalls } = await import('../lib/koenigTrainerTechCallsApi.js');
const db = getDb();
// One read-only call for every trainer's tech calls since 2022 (the feed takes a date range).
const trainerFeed = await getTrainerTechCalls('2022-01-01', new Date().toISOString().slice(0, 10));
const feedStart = trainerFeed.map((x) => ym(x.date)).filter(Boolean).sort()[0];
console.log('trainer tech-call feed:', trainerFeed.length, 'rows, earliest', feedStart);

const ids = PAST_ML.cases.map((c) => c.id);
const marks = ids.map(() => '?').join(',');
const emp = {};
for (const r of (await db.execute({ sql: `SELECT id, email, doj, tech_calls_details, tech_calls_converted_details FROM employees WHERE id IN (${marks})`, args: ids })).rows) emp[r.id] = r;

const J = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
const mi = (m) => { const [y, mo] = m.split('-').map(Number); return y * 12 + mo - 1; };
const fromMi = (n) => `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`;
const IST_MS = 5.5 * 3600e3;
const istMonth = (iso) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 7);

for (const c of PAST_ML.cases) {
  const e = emp[c.id];
  const d = new Date(e.doj);
  const dojYm = isNaN(d) ? '0000-00' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  c.rows = c.rows.filter((r) => !['meetings', 'techcalls', 'techconv'].includes(r.key));

  // Teams meetings on the calendar (cancelled and declined left out) — scheduled, not proof of attendance.
  const first = c.months[0], last = c.months[c.months.length - 1];
  const from = new Date(Date.UTC(+first.slice(0, 4), +first.slice(5) - 1, 1) - IST_MS).toISOString();
  const to = new Date(Date.UTC(+last.slice(0, 4), +last.slice(5), 1) - IST_MS).toISOString();
  let counts = null;
  try {
    const ev = (await getCalendarTeamsMeetings(e.email, from, to)).filter((x) => x.responseStatus?.response !== 'declined');
    counts = {};
    for (const x of ev) { const k = istMonth(`${x.start.dateTime.replace(/(\.\d{3})\d*/, '$1')}Z`); counts[k] = (counts[k] || 0) + 1; }
  } catch (err) { console.log(c.id, 'calendar failed:', err.message.slice(0, 80)); }
  c.rows.push({ key: 'meetings', label: 'Teams meetings (calendar)', kind: 'count', values: c.months.map((m) => (counts && m >= dojYm ? (counts[m] || 0) : null)) });

  // Tech calls from the stored lists; months before the list's first record are unknown.
  if (c.team === 'Trainer') {
    const code = String(c.id).replace(/\D/g, '');
    const calls = trainerFeed.filter((x) => x.empCode === code);
    const firstM = feedStart;
    const by = (f) => { const o = {}; for (const x of calls) if (f(x)) o[ym(x.date)] = (o[ym(x.date)] || 0) + 1; return o; };
    const all = by(() => true), conv = by((x) => x.converted);
    const known = (m) => firstM && m >= firstM && m >= dojYm;
    c.rows.push({ key: 'techcalls', label: 'Tech calls taken', kind: 'count', values: c.months.map((m) => (known(m) ? (all[m] || 0) : null)) });
    c.rows.push({ key: 'techconv', label: 'Tech calls converted', kind: 'count', values: c.months.map((m) => (known(m) ? (conv[m] || 0) : null)) });
  }
  console.log(c.id, c.team, c.rows.map((r) => `${r.key}:${r.values.map((v) => v ?? '–').join('/')}`).join('  '));
}

const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pastMl.js'), 'utf8');
const head = src.slice(0, src.indexOf('export const PAST_ML'));
fs.writeFileSync(path.join(__dirname, '..', 'lib', 'pastMl.js'), `${head}export const PAST_ML = ${JSON.stringify(PAST_ML, null, 1)};\n`);
console.log('pastMl.js updated');
process.exit(0);
