// Before/after-appraisal comparison for the Analysis screen. For each employee
// with a latest appraisal, the same number of FULL calendar months is taken on
// either side of it and the delivery numbers are compared:
//   Sales   — NR, True NR (avg per month), SCs raised (per month)
//   Trainer — utilization (avg per month), negative feedback (count)
// The appraisal month itself is left out (the change takes effect part-way
// through it), except an appraisal dated on the 1st, which counts from that
// month. Only completed months are used after, so the window is
// min(requested, completed months since the appraisal). A metric with a gap in
// the "before" or "after" months (joined too recently, or older than the
// feed's history) shows no comparison rather than a misleading one.

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// 'Oct-2026' / 'Oct 2026' -> year*12+month
function keyIdx(key) {
  const m = /^([A-Za-z]{3})[a-z]*[-\s](\d{4})$/.exec(String(key || '').trim());
  if (!m) return null;
  const mi = MON.indexOf(m[1].toLowerCase());
  return mi < 0 ? null : parseInt(m[2], 10) * 12 + mi;
}
// '2026-09-25T13:06:41' or '19-Jun-2026 16:12 PM' -> year*12+month
function dateIdx(v) {
  const s = String(v || '');
  let m = /^(\d{4})-(\d{2})-\d{2}/.exec(s);
  if (m) return parseInt(m[1], 10) * 12 + parseInt(m[2], 10) - 1;
  m = /^\d{1,2}-([A-Za-z]{3})-(\d{4})/.exec(s);
  if (m) { const mi = MON.indexOf(m[1].toLowerCase()); return mi < 0 ? null : parseInt(m[2], 10) * 12 + mi; }
  return null;
}
// employees.doj is a display string like "19 May 25" / "07 Sept 26".
function dojIdx(doj) {
  const m = /^\d{1,2}\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{2,4})$/.exec(String(doj || '').trim());
  if (!m) return null;
  const mi = MON.indexOf(m[1].toLowerCase());
  if (mi < 0) return null;
  return (Number(m[2]) < 100 ? 2000 + Number(m[2]) : Number(m[2])) * 12 + mi;
}

// Earliest month each feed has history for (the feeds only reach back so far).
const FEED_START = { sc: 2024 * 12 + 10, negFeedback: 2023 * 12 + 7 };

export function appraisalWindow(appraisalDate, maxMonths, now = new Date()) {
  const a = new Date(`${appraisalDate}T00:00:00`);
  if (Number.isNaN(a.getTime())) return null;
  const idx = a.getFullYear() * 12 + a.getMonth();
  const afterStart = a.getDate() <= 1 ? idx : idx + 1;
  const currentIdx = now.getFullYear() * 12 + now.getMonth();
  const k = Math.min(maxMonths, currentIdx - afterStart);
  if (k < 1) return null;
  // before = the k full months ending the month before the appraisal month
  const bEnd = idx - 1;
  return { k, before: [bEnd - k + 1, bEnd], after: [afterStart, afterStart + k - 1] };
}

const range = ([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

// Average per month from a monthly series — every month in both windows must
// be present, otherwise no comparison.
function monthlyAvg(details, field, win, doj) {
  if (!details?.length) return null;
  const byMonth = new Map();
  for (const d of details) { const i = keyIdx(d.month); if (i != null && Number.isFinite(Number(d[field]))) byMonth.set(i, Number(d[field])); }
  const take = (r) => { const vals = range(r).map((i) => byMonth.get(i)); return vals.some((v) => v === undefined) ? null : sum(vals) / vals.length; };
  if (doj != null && win.before[0] < doj) return null;
  const before = take(win.before), after = take(win.after);
  return before == null || after == null ? null : { before, after };
}

// Event count per month from dated records. The "before" window must sit inside
// both the feed's history and the employee's tenure.
function eventRate(records, dateOf, feedStart, win, doj, perMonth) {
  const lowest = Math.max(feedStart, doj ?? 0);
  if (win.before[0] < lowest) return null;
  const count = (r) => (records || []).filter((x) => { const i = dateIdx(dateOf(x)); return i != null && i >= r[0] && i <= r[1]; }).length;
  const b = count(win.before), a = count(win.after);
  return perMonth ? { before: b / win.k, after: a / win.k } : { before: b, after: a };
}

function change(pair) {
  if (!pair) return null;
  const delta = pair.after - pair.before;
  const pct = pair.before !== 0 ? (delta / Math.abs(pair.before)) * 100 : null;
  return { ...pair, delta, pct };
}

// Per-metric direction: 'up' = an increase is good, 'down' = an increase is bad.
export const ANALYSIS_METRICS = {
  Sales: [
    { key: 'nr', label: 'NR / month', good: 'up', kind: 'money' },
    { key: 'trueNr', label: 'True NR / month', good: 'up', kind: 'money' },
    { key: 'sc', label: 'SCs raised / month', good: 'up', kind: 'rate' },
  ],
  Trainer: [
    { key: 'util', label: 'Utilization (avg)', good: 'up', kind: 'percent' },
    { key: 'neg', label: 'Negative feedback', good: 'down', kind: 'count' },
  ],
};

// The same before/after comparison around any dated event — an appraisal, an
// RnR award, a PA or a PIP being issued (eventDate is 'YYYY-MM-DD').
export function computeEventImpact(e, eventDate, maxMonths) {
  const win = appraisalWindow(eventDate, maxMonths);
  if (!win) return { eventDate, tooRecent: true };
  const doj = dojIdx(e.doj);
  const metrics = {};
  if (e.team === 'Sales') {
    metrics.nr = change(monthlyAvg(e.nrMonthlyDetails, 'nr', win, doj));
    metrics.trueNr = change(monthlyAvg(e.trueNrDetails, 'trueNr', win, doj));
    metrics.sc = change(eventRate(e.scDetails, (x) => x.createdOn, FEED_START.sc, win, doj, true));
  } else if (e.team === 'Trainer') {
    metrics.util = change(monthlyAvg(e.utilMonthlyDetails, 'util', win, doj));
    metrics.neg = change(eventRate(e.negFeedbackDetails, (x) => x.feedbackDate, FEED_START.negFeedback, win, doj, false));
  }
  return { eventDate, k: win.k, metrics };
}

// Koenig lists a new joiner's joining salary as their first "appraisal", dated on
// the joining day. That is not an appraisal, so a record dated within a week of
// the DOJ is skipped.
const JOINING_RECORD_DAYS = 7;
function dojDate(doj) {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{2,4})$/.exec(String(doj || '').trim());
  if (!m) return null;
  const mi = MON.indexOf(m[2].toLowerCase());
  return mi < 0 ? null : new Date(Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]), mi, Number(m[1]));
}
// The employee's most recent real appraisal ({ appraisalDate, ... }) or null.
export function latestRealAppraisal(e) {
  const d = dojDate(e.doj);
  return (e.appraisalDetails || []).find((a) => {
    if (!a?.appraisalDate) return false;
    if (!d) return true;
    const at = new Date(`${a.appraisalDate}T00:00:00`);
    return Number.isNaN(at.getTime()) || Math.abs(at - d) / 864e5 > JOINING_RECORD_DAYS;
  }) || null;
}

// Why a before / after cell has no numbers, in words, for the table.
export function blankReason(e, eventDate, months, what = 'NR') {
  const win = appraisalWindow(eventDate, months);
  if (!win) return 'Too recent — no completed month after it yet';
  const doj = dojIdx(e.doj);
  if (doj != null && win.before[0] < doj) return `Joined ${String(e.doj).trim()} — under ${win.k} months of ${what} before this date`;
  if (what === 'NR' && win.before[0] < 2025 * 12 + 4) return 'The NR feed starts May 2025 — the months before this date are not available';
  return `${what} missing for some of the ${win.k} months compared`;
}

export function computeAppraisalImpact(e, maxMonths) {
  const latest = latestRealAppraisal(e);
  if (!latest?.appraisalDate) return null;
  return computeEventImpact(e, latest.appraisalDate, maxMonths);
}

// pip_status.issued_on is a display string like '14 Oct 2026'.
export function displayDateToIso(s) {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const mi = MON.indexOf(m[2].toLowerCase());
  return mi < 0 ? null : `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// The most recently issued PA or PIP ('PA' | 'PIP') -> { date, label } or null.
export function latestPipEvent(e, type) {
  const cases = (e.pipHistory || [])
    .filter((p) => p.type === type)
    .map((p) => ({ date: displayDateToIso(p.issuedOn), reviewBy: p.reviewBy }))
    .filter((p) => p.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  return cases[0] ? { date: cases[0].date, label: cases[0].reviewBy ? `review by ${cases[0].reviewBy}` : '' } : null;
}

// Awards are for the quarter just ended and handed out after it, so the event
// is the 1st of the month after the quarter: the quarter's own months are the
// "before" window, and the months from the award onwards are "after".
export function rnrAwardDate(quarter, year) {
  const q = Number(String(quarter).replace(/\D/g, ''));
  if (!q) return null;
  const idx = year * 12 + q * 3;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
}

// ---- chart data ----

const monthLabel = (idx) => `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][idx % 12]} ${String(Math.floor(idx / 12)).slice(2)}`;

// Month-by-month series for one metric (completed months only, from the
// feed's start / the employee's joining month): [{ idx, label, value }].
export function metricSeries(e, key, now = new Date()) {
  const currentIdx = now.getFullYear() * 12 + now.getMonth();
  const doj = dojIdx(e.doj);
  const out = [];
  const fromMonthly = (details, field) => {
    for (const d of details || []) {
      const i = keyIdx(d.month);
      const v = Number(d[field]);
      if (i != null && i < currentIdx && Number.isFinite(v) && (doj == null || i >= doj)) out.push({ idx: i, label: monthLabel(i), value: v });
    }
  };
  const fromEvents = (records, dateOf, feedStart) => {
    const lo = Math.max(feedStart, doj ?? 0);
    const counts = new Map();
    for (const r of records || []) { const i = dateIdx(dateOf(r)); if (i != null && i >= lo && i < currentIdx) counts.set(i, (counts.get(i) || 0) + 1); }
    for (let i = lo; i < currentIdx; i++) out.push({ idx: i, label: monthLabel(i), value: counts.get(i) || 0 });
  };
  if (key === 'nr') fromMonthly(e.nrMonthlyDetails, 'nr');
  else if (key === 'trueNr') fromMonthly(e.trueNrDetails, 'trueNr');
  else if (key === 'util') fromMonthly(e.utilMonthlyDetails, 'util');
  else if (key === 'sc') fromEvents(e.scDetails, (x) => x.createdOn, FEED_START.sc);
  else if (key === 'neg') fromEvents(e.negFeedbackDetails, (x) => x.feedbackDate, FEED_START.negFeedback);
  return out.sort((a, b) => a.idx - b.idx);
}

// Least-squares line through [{x, y}] -> { slope, intercept } (null under 2 points).
export function linearTrend(points) {
  if (points.length < 2) return null;
  const n = points.length;
  const sx = sum(points.map((p) => p.x)), sy = sum(points.map((p) => p.y));
  const sxx = sum(points.map((p) => p.x * p.x)), sxy = sum(points.map((p) => p.x * p.y));
  const denom = n * sxx - sx * sx;
  if (!denom) return null;
  const slope = (n * sxy - sx * sy) / denom;
  return { slope, intercept: (sy - slope * sx) / n };
}

// Where the appraisal sits on the month axis (fractional month index).
export function appraisalPosition(appraisalDate) {
  const a = new Date(`${appraisalDate}T00:00:00`);
  const dim = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
  return a.getFullYear() * 12 + a.getMonth() + (a.getDate() - 1) / dim;
}
