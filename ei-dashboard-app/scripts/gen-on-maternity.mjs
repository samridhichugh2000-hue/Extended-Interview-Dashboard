// Regenerates lib/onMaternity.js — maternity leaves (30+ days, not rejected) for
// the sections the Past ML snapshot does not cover (PT, FM, Recruitment), so the
// dashboard can write "Maternity" under a name while the leave is on. Sales and
// Trainer come from lib/pastMl.js. Leave rows come from the Koenig "Get Employee
// Leave Details" feed (apikey 237) — read-only, one call per employee, nothing
// written to the database. Credentials: KOENIG_LEAVE_API_* in .env.local.
//   node scripts/gen-on-maternity.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });
const { getDb } = await import('../lib/db.js');
const db = getDb();
const e = process.env;
const emps = (await db.execute("SELECT id, name, team FROM employees WHERE active = 1 AND team IN ('PT Team','FM Team','Recruitment Team')")).rows.map((r) => ({ ...r }));
const base = e.KOENIG_API_BASE_URL || 'https://api.koenig-solutions.com';
const tk = (await (await fetch(`${base}/api/Kites/Operator/GetToken`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName: e.KOENIG_LEAVE_API_USERNAME, userPassword: e.KOENIG_LEAVE_API_PASSWORD, userRole: e.KOENIG_LEAVE_API_ROLE || 'Get Employee Leave Details' }) })).json()).content;
if (!tk) throw new Error('leave API login failed');
const url = `${base}/api/Kites/Operator/common?apikey=237&accessToken=${encodeURIComponent(tk.accessToken)}&deviceToken=${encodeURIComponent(tk.deviceToken)}`;
let ix = 0, failed = 0;
async function worker() {
  while (ix < emps.length) {
    const m = emps[ix++];
    try {
      const j = await (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emp_code: String(m.id).replace(/\D/g, '') }) })).json();
      let r = j.content; if (typeof r === 'string') r = JSON.parse(r);
      m.leaves = r || [];
    } catch { m.leaves = []; failed++; }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

const today = new Date().toISOString().slice(0, 10);
const days = (r) => Math.round((new Date(r.to_date) - new Date(r.from_date)) / 864e5) + 1;
const cases = [];
for (const m of emps) {
  const rows = m.leaves.filter((r) => /matern/i.test(r.leave_type || '') && days(r) >= 30 && r.leave_status !== 'Rejected' && r.to_date.slice(0, 10) >= today);
  if (!rows.length) continue;
  cases.push({ id: m.id, name: m.name, team: m.team, from: rows.map((r) => r.from_date.slice(0, 10)).sort()[0], to: rows.map((r) => r.to_date.slice(0, 10)).sort().slice(-1)[0], approval: rows.some((r) => r.leave_status === 'Approved') ? 'Approved' : 'In process' });
}
const src = `// Generated ${today} by scripts/gen-on-maternity.mjs (re-run to refresh). Current and upcoming
// maternity leaves for PT, FM and Recruitment (Sales / Trainer are in lib/pastMl.js).
// Used only to write "Maternity" under a name — not used by the Worry Index, PA or PIP.
export const ON_MATERNITY = ${JSON.stringify({ generated: today, cases }, null, 1)};
`;
fs.writeFileSync(path.join(__dirname, '..', 'lib', 'onMaternity.js'), src);
console.log(`${emps.length} employees checked (${failed} calls failed): ${cases.length} on or starting maternity`, cases.map((c) => `${c.name} (${c.team}) ${c.from}..${c.to} ${c.approval}`));
process.exit(0);
