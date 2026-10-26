// Days with minimum activity — three separate checks per working day, each
// counted on its own (never merged into one flag):
//   RMS     fewer than LOW_RMS_CLICKS menu visits that day (every menu counts)
//   Email   no email sent that day (Outlook Sent Items; mail received doesn't count)
//   Meeting no Teams meeting attended that day (call records, VIDEO_MIN_ATTEND_SECONDS+)
// Saturdays and Sundays are skipped, and so are days on approved leave.
// This module only READS and computes — it never writes to Turso — so a dry run
// can show the counts before anything is stored.
import { getDb } from './db.js';
import { graphFetch } from './graphAuth.js';
import { VIDEO_MIN_ATTEND_SECONDS } from './videoRules.js';

export const LOW_RMS_CLICKS = 5;
export const LOW_ACTIVITY_DAYS = Number(process.env.LOW_ACTIVITY_DAYS || 30);
const BASE = process.env.KOENIG_API_BASE_URL || 'https://api.koenig-solutions.com';
const IST_MS = 5.5 * 3600 * 1000;

const istDay = (d) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const dayOfWeek = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();

// The working days (Mon-Fri) in the trailing window, ending yesterday (IST).
export function workingDays(days = LOW_ACTIVITY_DAYS, now = new Date()) {
  const out = [];
  for (let i = days; i >= 1; i--) {
    const day = istDay(new Date(now.getTime() - i * 864e5));
    const dow = dayOfWeek(day);
    if (dow !== 0 && dow !== 6) out.push(day);
  }
  return out;
}

async function koenigToken(userName, userPassword, userRole) {
  const res = await fetch(`${BASE}/api/Kites/Operator/GetToken`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName, userPassword, userRole }) });
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig GetToken failed for ${userRole}: ${json.message}`);
  return json.content;
}

async function koenigCall(apikey, token, body, timeoutMs = 120000) {
  const url = `${BASE}/api/Kites/Operator/common?apikey=${apikey}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      const json = await res.json();
      if (json.statuscode !== 200) throw new Error(json.message || `status ${json.statuscode}`);
      return typeof json.content === 'string' ? JSON.parse(json.content) : json.content || [];
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

// RMS Activity Report (apikey 472): one call per day, tallied straight into
// per-employee click counts — the ~17,000 raw rows a day are never kept.
// Returns Map(day -> Map(empNumber -> clicks)).
export async function rmsClicksByDay(days, creds, onDay) {
  const token = await koenigToken(creds.userName, creds.userPassword, creds.userRole);
  const out = new Map();
  for (const day of days) {
    const rows = await koenigCall(472, token, { from_date: day, to_date: day });
    const m = new Map();
    for (const r of rows) {
      const id = Number(r.EmpId);
      if (!id) continue;
      m.set(id, (m.get(id) || 0) + 1);
    }
    out.set(day, m);
    if (onDay) onDay(day, m);
  }
  return out;
}

// Days (IST) on which this mailbox sent at least one email. Only the send
// timestamp is requested — no subjects, recipients or bodies.
export async function emailDaysSent(email, fromIso) {
  const days = new Set();
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/mailFolders/sentitems/messages?` + new URLSearchParams({ $select: 'sentDateTime', $top: '500', $filter: `sentDateTime ge ${fromIso}` });
  while (url) {
    const res = await graphFetch(url);
    if (!res.ok) { const err = new Error(`Graph sentItems failed: ${res.status}`); err.status = res.status; throw err; }
    const json = await res.json();
    for (const m of json.value || []) days.add(istDay(new Date(m.sentDateTime)));
    url = json['@odata.nextLink'] || null;
  }
  return days;
}

// Days each employee attended a Teams meeting (from the call records already
// stored in video_meetings — no new Microsoft calls). Map(employeeId -> Set(day)).
export async function meetingDays(fromIso) {
  const rows = (await getDb().execute({ sql: 'SELECT employee_id, started_at FROM video_meetings WHERE started_at >= ? AND attended_seconds >= ?', args: [fromIso, VIDEO_MIN_ATTEND_SECONDS] })).rows;
  const out = new Map();
  for (const r of rows) {
    const d = istDay(new Date(r.started_at));
    if (!out.has(r.employee_id)) out.set(r.employee_id, new Set());
    out.get(r.employee_id).add(d);
  }
  return out;
}

// Approved leave days for one employee (Koenig "Get Employee Leave Details",
// apikey 237). Half-days count as a working day, so only full-day or longer
// approved leaves are returned. Returns a Set of YYYY-MM-DD.
export async function approvedLeaveDays(empNumber, token) {
  const rows = await koenigCall(237, token, { emp_code: String(empNumber) });
  const out = new Set();
  for (const r of rows) {
    if (r.leave_status !== 'Approved' || /half/i.test(r.leave_type || '') || /^(Work From Home|Travel|Conference|Out Of Office)$/i.test(r.leave_type || '')) continue;
    // Read the calendar date as UTC midnight: parsing the bare string as local time shifted every leave by a day.
    const a = new Date(`${String(r.from_date).slice(0, 10)}T00:00:00Z`), b = new Date(`${String(r.to_date).slice(0, 10)}T00:00:00Z`);
    if (isNaN(a) || isNaN(b)) continue;
    const span = Math.round((b - a) / 864e5) + 1;
    if (span > 120) continue; // placeholder-style entries, not real leave
    for (let k = 0; k < span; k++) out.add(new Date(a.getTime() + k * 864e5).toISOString().slice(0, 10));
  }
  return out;
}

export async function leaveToken(creds) { return koenigToken(creds.userName, creds.userPassword, creds.userRole); }

// ---- Sync ------------------------------------------------------------------
// Call records are only stored from this date (Microsoft keeps ~30 days, and
// the video sync began on 20 Sep 2026), so earlier days have no meeting data
// at all — they are never counted as "no meeting".
export const MEETING_TRACKING_START = '2026-09-20';
// Six months of flagged dates are kept, matching the Worry Index's longest window.
export const STORE_DAYS = 182;
// The first run only looks this far back in Sent Items (RMS gets the full six
// months because that API is one cheap call per day). Later runs add days, so
// email history grows from here instead of being pulled all at once.
export const EMAIL_FIRST_DAYS = 30;

// Computes and stores, per active employee, the dates on which each of the three
// checks was low, plus (low_activity_meta) the date each check's coverage starts
// and the employee's approved-leave days — what the Worry Index needs to work
// out "low days out of working days" for any window. Incremental: after the
// first run only the days since the last run are fetched. No click counts, menus
// or email details are stored. dry=true reports but writes nothing.
// creds: { rms: {userName,userPassword,userRole}, leave: {...} }
// cachePath (optional): file keeping the per-day RMS tallies so an interrupted
// first run does not repeat finished days.
export async function syncLowActivity({ dry = false, full = false, creds, cachePath } = {}) {
  const fs = await import('fs');
  const db = getDb();
  const rows = (await db.execute('SELECT id, team, email, doj, low_rms_days, low_email_days, low_meeting_days, low_activity_meta, low_activity_synced_at FROM employees WHERE active = 1')).rows;
  const allDays = workingDays(STORE_DAYS);
  const windowStart = allDays[0];
  const emailFirst = allDays.find((d) => d >= istDay(new Date(Date.now() - EMAIL_FIRST_DAYS * 864e5))) || allDays[0];
  const meetFirst = windowStart > MEETING_TRACKING_START ? windowStart : MEETING_TRACKING_START;
  // Resume point: the oldest "last synced" day, or the full window if anyone has never been synced.
  const syncedDays = rows.map((r) => (r.low_activity_synced_at ? istDay(new Date(r.low_activity_synced_at)) : null));
  const resumeAfter = !full && syncedDays.every(Boolean) ? syncedDays.sort()[0] : null;
  const days = resumeAfter ? allDays.filter((d) => d > resumeAfter) : allDays;
  if (!days.length) return { message: 'Low-activity days already up to date.' };
  console.log(`Evaluating ${days.length} working days (${days[0]} to ${days[days.length - 1]})${dry ? ' — DRY RUN, nothing written' : ''}`);

  // RMS: one call per day, tallies kept (not rows); cached on disk if asked.
  let cache = {};
  if (cachePath && fs.existsSync(cachePath)) cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const missing = days.filter((d) => !cache[d]);
  if (missing.length) {
    const fresh = await rmsClicksByDay(missing, creds.rms, (day, m) => {
      cache[day] = Object.fromEntries(m);
      if (cachePath) fs.writeFileSync(cachePath, JSON.stringify(cache));
    });
    for (const [d, m] of fresh) cache[d] = Object.fromEntries(m);
  }
  console.log(`RMS: ${days.length} days ready (${missing.length} fetched)`);

  const meetDays = days.filter((d) => d >= meetFirst);
  const meet = await meetingDays(new Date(`${(meetDays[0] || days[0])}T00:00:00+05:30`).toISOString());
  const emailDaysToCheck = days.filter((d) => d >= emailFirst);
  const emailFromIso = emailDaysToCheck.length ? new Date(`${emailDaysToCheck[0]}T00:00:00+05:30`).toISOString() : null;
  const lt = await leaveToken(creds.leave);
  const num = (id) => Number(String(id).replace(/\D/g, ''));
  const dojDay = (doj) => { const d = new Date(doj); return isNaN(d) ? '0000-00-00' : d.toISOString().slice(0, 10); };
  const parse = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
  const parseObj = (s) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
  const last = days[days.length - 1];

  let ix = 0, noMailbox = 0, failed = 0;
  const updates = [];
  const tot = { days: 0, rms: 0, email: 0, meeting: 0 };
  async function worker() {
    while (ix < rows.length) {
      const e = rows[ix++];
      try {
        const meta = parseObj(e.low_activity_meta);
        const from = {
          rms: meta.from?.rms && meta.from.rms > windowStart ? meta.from.rms : windowStart,
          email: meta.from?.email && meta.from.email > windowStart ? meta.from.email : emailFirst,
          meeting: meta.from?.meeting && meta.from.meeting > windowStart ? meta.from.meeting : meetFirst,
        };
        let sent = null;
        if (e.email && emailFromIso) {
          try { sent = await emailDaysSent(e.email, emailFromIso); } catch (err) { if (err.status === 404) noMailbox++; else throw err; }
        }
        const leaveAll = await approvedLeaveDays(num(e.id), lt);
        const leave = [...leaveAll].filter((d) => d >= windowStart && d <= last && dayOfWeek(d) !== 0 && dayOfWeek(d) !== 6).sort();
        const doj = dojDay(e.doj);
        const mine = meet.get(e.id) || new Set();
        const keep = (stored) => (resumeAfter ? parse(stored).filter((d) => d >= windowStart && d <= resumeAfter) : []);
        const rms = keep(e.low_rms_days), email = keep(e.low_email_days), meeting = keep(e.low_meeting_days);
        for (const d of days) {
          if (d < doj || leaveAll.has(d)) continue;
          tot.days++;
          if (d >= from.rms && (cache[d]?.[num(e.id)] || 0) < LOW_RMS_CLICKS) { rms.push(d); tot.rms++; }
          if (sent && d >= from.email && !sent.has(d)) { email.push(d); tot.email++; }
          if (d >= from.meeting && !mine.has(d)) { meeting.push(d); tot.meeting++; }
        }
        updates.push({ id: e.id, rms, email: (sent || (resumeAfter && e.low_email_days)) ? email : null, meeting, meta: { from, leave } });
      } catch (err) { failed++; console.error(`Low-activity failed for ${e.id}:`, err.message); }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  if (!dry) {
    const now = new Date().toISOString();
    for (let i = 0; i < updates.length; i += 100) {
      await db.batch(updates.slice(i, i + 100).map((u) => ({
        sql: 'UPDATE employees SET low_rms_days = ?, low_email_days = ?, low_meeting_days = ?, low_activity_meta = ?, low_activity_synced_at = ? WHERE id = ?',
        args: [JSON.stringify(u.rms), u.email ? JSON.stringify(u.email) : null, JSON.stringify(u.meeting), JSON.stringify(u.meta), now, u.id],
      })), 'write');
    }
  }
  return { message: `Low-activity days for ${updates.length} employees (${failed} failed, ${noMailbox} with no mailbox). New employee-days ${tot.days}: RMS<${LOW_RMS_CLICKS} ${tot.rms}, no email ${tot.email}, no meeting ${tot.meeting}.${dry ? ' Nothing written.' : ''}` };
}
