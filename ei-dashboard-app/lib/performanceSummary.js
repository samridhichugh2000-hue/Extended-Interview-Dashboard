// Quarterly "Performance Summary" email: which CSMs are below the target-achievement bar, who is left out
// and why, and the email itself. Pure (no DB, no network) so the PA/PIP tracking tab and the send route
// compute the list the same way — the route recomputes it server-side rather than trusting the browser.
import { displayDateToIso } from './analysis.js';
import { quarterTrueNr } from './quarterTrueNr.js';

export const BELOW_PCT = 30;
export const REMINDER_DAY = 5; // of the 2nd month of the quarter
export const REMINDER_TO = 'rashi.oberoi@koenig-solutions.com';
export const REMINDER_CC = 'samridhi.chugh@koenig-solutions.com';
export const HR_ADDRESS = 'HR@koenig-solutions.com';
// Same arrangement as the PA/PIP alert emails: sent out of the app's mailbox with HR@ as the From address.
export const TEST_RECIPIENTS = ['samridhi.chugh@koenig-solutions.com', 'Rashi.oberoi@koenig-solutions.com'];

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON_NAME = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

// "Today" as an IST calendar date, whatever the machine's own zone is (Vercel runs in UTC).
export function istToday(now = new Date()) {
  const t = new Date(now.getTime() + 5.5 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function quarterOf(iso) {
  const [y, m] = iso.split('-').map(Number);
  return { name: `Q${Math.floor((m - 1) / 3) + 1}`, year: y };
}
export const quarterLabel = (q) => `${q.name} ${q.year}`;
export const quarterKey = (q) => `${q.year}-${q.name}`;
export function quarterMonths(q) {
  const start = (Number(q.name.slice(1)) - 1) * 3;
  return [0, 1, 2].map((i) => `${MON_NAME[start + i]}-${q.year}`);
}

// The day the reminder (and the dashboard note) kicks in: the 5th of the quarter's second month.
export function reminderDate(q) {
  const secondMonth = (Number(q.name.slice(1)) - 1) * 3 + 2; // 1-based
  return `${q.year}-${pad(secondMonth)}-${pad(REMINDER_DAY)}`;
}
export const isReminderDay = (iso) => iso === reminderDate(quarterOf(iso));

// Employees.doj is a display string like "05 Sept 26" or "10 Oct 25" (2-digit year).
export function parseDoj(s) {
  const m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{2}|\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const mi = MON.indexOf(m[2].slice(0, 3).toLowerCase());
  if (mi < 0) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${pad(mi + 1)}-${pad(Number(m[1]))}`;
}

// First-quarter rule — a new joiner needs enough time in a quarter to be measured:
//  - joined during the quarter (or after it)  -> not eligible for that quarter;
//  - joined in the previous quarter with at least MIN_DAYS_IN_QUARTER days in it (joining day to quarter end,
//    inclusive) -> eligible this quarter; with fewer days -> still not eligible this quarter either.
// e.g. 10 Oct joiner: out of Q4, in for Q1. 10/25/28 Dec joiner (under 45 days): out of Q4 and Q1.
export const MIN_DAYS_IN_QUARTER = 45;
const quarterBounds = (q) => {
  const sm = (Number(q.name.slice(1)) - 1) * 3;
  return { start: new Date(Date.UTC(q.year, sm, 1)), end: new Date(Date.UTC(q.year, sm + 3, 0)) };
};
const isoOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export function joinedTooRecently(dojIso, q) {
  if (!dojIso) return false;
  const cur = quarterBounds(q);
  if (dojIso >= isoOf(cur.start)) return true; // joined in this quarter (or later)
  const prevQ = Number(q.name.slice(1)) === 1 ? { name: 'Q4', year: q.year - 1 } : { name: `Q${Number(q.name.slice(1)) - 1}`, year: q.year };
  const prev = quarterBounds(prevQ);
  if (dojIso < isoOf(prev.start)) return false; // joined earlier than the previous quarter
  const doj = new Date(dojIso + 'T00:00:00Z');
  const daysInJoiningQuarter = Math.round((prev.end - doj) / 86400000) + 1;
  return daysInJoiningQuarter < MIN_DAYS_IN_QUARTER;
}

// "Running right now" = status says PA/PIP and today sits inside that record's issued..review-by window.
// Koenig leaves lapsed cases flagged, so the status alone is not enough (same test as the PA/PIP tracking tab).
export function ongoingPaPip(e, todayIso) {
  const want = e.status === 'PIP Issued' ? 'PIP' : e.status === 'PA Issued' ? 'PA' : null;
  if (!want) return null;
  const hit = (e.pipHistory || []).find((p) => {
    if (p.type !== want) return false;
    const from = displayDateToIso(p.issuedOn), to = displayDateToIso(p.reviewBy);
    return !!from && !!to && from <= todayIso && todayIso <= to;
  });
  return hit ? { type: want, reviewBy: hit.reviewBy } : null;
}

// Achievement = the employee's True NR from the Koenig API for all three months of the quarter (lib/quarterTrueNr.js -
// the same definition the whole dashboard uses) against their individual target. ASM targets are team-level: left out.
export function quarterAchievement(e, q) {
  const qt = (e.quarterTargets || []).find((t) => t.name === q.name && t.year === q.year);
  if (!qt || !(qt.amount > 0) || qt.type === 'ASM') return null;
  const t = quarterTrueNr(e, q);
  if (!t.monthsAvailable) return null; // the API has returned no True NR for this quarter - nothing to judge
  return { target: qt.amount, achieved: t.total, pct: Math.round((t.total / qt.amount) * 1000) / 10 };
}

// Splits every Sales target-holder below the bar into who gets the email and who is left out, and why.
// groups.eligible: auto-selected (minus anyone HR unchecks) · onPaPip: shown at the bottom, never emailed ·
// newJoiner: first-quarter exclusion, shown for transparency.
export function buildPerformanceSummary(employees, { today, quarter } = {}) {
  const todayIso = today || istToday();
  const q = quarter || quarterOf(todayIso);
  const groups = { eligible: [], onPaPip: [], newJoiner: [] };
  for (const e of employees) {
    if (e.team !== 'Sales' || e.active === false) continue;
    const a = quarterAchievement(e, q);
    if (!a || !(a.pct < BELOW_PCT)) continue;
    const doj = parseDoj(e.doj);
    const row = { id: e.id, name: e.name, email: e.email || null, manager: e.manager || null, designation: e.designation || null, doj: e.doj, dojIso: doj, resigned: !!e.dor, ...a };
    if (joinedTooRecently(doj, q)) { groups.newJoiner.push(row); continue; }
    const pa = ongoingPaPip(e, todayIso);
    if (pa) groups.onPaPip.push({ ...row, paType: pa.type, reviewBy: pa.reviewBy });
    else groups.eligible.push(row);
  }
  for (const k of Object.keys(groups)) groups[k].sort((x, y) => x.pct - y.pct);
  return { quarter: q, label: quarterLabel(q), key: quarterKey(q), groups };
}

// Emails that went out and were then recalled / disregarded. Sent Items still lists them as sent and Outlook gives no
// way to tell, so they are recorded here by employee id: they count as NOT emailed, so anyone still below the bar is back under Eligible.
// Q4 2026 (9 Nov 2026 round): Utkarsh Ghule, Chris Tzalabiras, Vinay Narayanan recalled; Mudit Misra, Saurabh Banerjee,
// Kuldip Parmar, Jay Singh got a "disregard" correction (the later months' booked revenue had been missed).
const RECALLED = { '2026-Q4': ['EMP4928', 'EMP2301', 'EMP3688', 'EMP3486', 'EMP2232', 'EMP2393', 'EMP4836'] };
export const isRecalled = (key, empId) => (RECALLED[key] || []).includes(empId);

// ---- email (identical to the Q4 2026 Performance Summary sent on 9 Nov 2026) ----
export function formatInr(n) {
  const neg = n < 0;
  const s = String(Math.round(Math.abs(n)));
  const last3 = s.slice(-3), rest = s.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return (neg ? '-' : '') + grouped;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const summarySubject = (q) => `${quarterLabel(q)} Performance Summary`;

export function summaryEmailHtml(row, q) {
  const L = quarterLabel(q);
  const pct = `${row.pct.toFixed(1)}%`;
  const first = String(row.name).trim().split(/\s+/)[0];
  const cell = 'border:1px solid #000;padding:4px 10px;';
  return `<div style="font-family:Calibri,Segoe UI,Arial,sans-serif;font-size:14px;color:#000;line-height:1.5">`
    + `<p>Dear ${esc(first)},</p>`
    + `<p>This is to bring to your attention that your ${L} True NR target achievement stands at ${pct}.</p>`
    + `<table style="border-collapse:collapse;font-size:14px"><tbody>`
    + `<tr style="background:#0087C8;color:#fff;font-weight:bold"><td style="${cell}text-align:center">CSM</td><td style="${cell}text-align:center">${L} Target</td><td style="${cell}text-align:center">Achieved ${L} True NR</td><td style="${cell}text-align:center">%age Achieved</td></tr>`
    + `<tr><td style="${cell}text-align:center">${esc(row.name)}</td><td style="${cell}text-align:right">${formatInr(row.target)}</td><td style="${cell}text-align:right">${formatInr(row.achieved)}</td><td style="${cell}text-align:right">${pct}</td></tr>`
    + `</tbody></table>`
    + `<p>This performance gap requires immediate attention. We strongly encourage you to review the contributing factors and take necessary corrective actions to improve results and align with the organization's growth objectives.</p>`
    + `<p>Kindly acknowledge receipt of this communication. We look forward to a marked improvement in the upcoming period.</p>`
    + `<p>Regards,<br />Team HR</p></div>`;
}

export const reminderSubject = (q) => `Performance Summary Email Due – ${quarterLabel(q)}`;
export function reminderHtml(baseUrl) {
  const link = baseUrl ? ` <a href="${esc(baseUrl)}">Open the EI Dashboard</a>.` : '';
  return `<div style="font-family:Calibri,Segoe UI,Arial,sans-serif;font-size:14px;color:#000;line-height:1.5">`
    + `<p>Hi Rashi,</p>`
    + `<p>The quarterly performance summary email is due. Kindly visit the EI Dashboard and review the list of eligible CSMs.${link}</p>`
    + `</div>`;
}
