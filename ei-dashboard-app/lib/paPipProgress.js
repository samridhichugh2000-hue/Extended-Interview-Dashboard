// "Since the PA / PIP" monitoring: for an employee on (or recently on) a PA or
// PIP, compare the period after it was issued with the period before it and
// say whether things improved or declined.
//
//   Sales   — target achievement (quarter of the issue vs the current quarter),
//             NR and True NR per month, SCs raised, CSM Index
//   Trainer — utilization per month, assignments started, negative feedback,
//             Trainer Index
//   FM Team / Recruitment Team — interviews, Common Index
//   PT Team — Common Index
//
// Monthly figures (NR, True NR, utilization, the index scores) compare the same
// number of COMPLETED months either side of the issue month, exactly as the
// Analysis screen's PA / PIP views do (computeEventImpact), so they only appear
// once a full month has passed. Dated records (SCs, assignments, negative
// feedback) compare equal runs of days — the days since the issue against the
// same number of days before it — so they show up within the first week.
import { computeEventImpact, displayDateToIso, dojDate, FEED_START, INDEX_FIELDS } from './analysis.js';
import { quarterTargetFor } from './quarterTarget.js';

const DAY = 86400000;
const MIN_DAYS = 7;   // fewer days since the issue than this is too early to read
const FM_INTERVIEWS_DAYS = 30; // lib/fmInterviewsApi.js's lookback — the feed holds no older interviews
const MAX_DAYS = 90;  // windows are capped so an old PA/PIP is not compared across a year
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// 'YYYY-MM-DD…', 'DD-Mon-YYYY' or 'DD Mon YYYY' -> local-midnight Date, else null.
function toDate(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s](\d{4})/.exec(s);
  const mi = m ? MON.indexOf(m[2].toLowerCase()) : -1;
  return mi < 0 ? null : new Date(Number(m[3]), mi, Number(m[1]));
}
// 'Oct-2026' / 'Oct 2026' -> year*12+month.
function keyIdx(key) {
  const m = /^([A-Za-z]{3})[a-z]*[-\s](\d{4})$/.exec(String(key || '').trim());
  const mi = m ? MON.indexOf(m[1].toLowerCase()) : -1;
  return mi < 0 ? null : Number(m[2]) * 12 + mi;
}
const monthIdxOf = (d) => d.getFullYear() * 12 + d.getMonth();
const MONTH_LABEL = (idx) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][idx % 12]} ${String(Math.floor(idx / 12)).slice(2)}`;
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtDay = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

// The PA or PIP being monitored: the one the employee's current status refers
// to; otherwise the most recently issued of either.
export function monitoredCase(e) {
  const cases = (e.pipHistory || [])
    .filter((p) => p.type === 'PA' || p.type === 'PIP')
    .map((p) => ({ type: p.type, date: displayDateToIso(p.issuedOn), reviewBy: p.reviewBy || null }))
    .filter((p) => p.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  const wanted = e.status === 'PIP Issued' ? 'PIP' : e.status === 'PA Issued' ? 'PA' : null;
  return (wanted && cases.find((c) => c.type === wanted)) || cases[0] || null;
}

const numPct = (label) => { const n = parseFloat(String(label)); return Number.isFinite(n) ? n : null; };
const quarterOf = (d) => ({ name: `Q${Math.floor(d.getMonth() / 3) + 1}`, year: d.getFullYear() });

function row(key, label, kind, good, before, after, window) {
  if (before == null || after == null) return { key, label, kind, good, before, after, window, delta: null, verdict: null };
  const delta = after - before;
  const verdict = delta === 0 ? 'same' : (good === 'up' ? delta > 0 : delta < 0) ? 'better' : 'worse';
  return { key, label, kind, good, before, after, window, delta, pct: before !== 0 ? (delta / Math.abs(before)) * 100 : null, verdict };
}
const missing = (key, label, kind, good, note) => ({ key, label, kind, good, before: null, after: null, delta: null, verdict: null, note });

export function computePaPipProgress(e, now = new Date()) {
  const c = monitoredCase(e);
  if (!c) return null;
  const issued = toDate(c.date);
  const today = midnight(now);
  const daysSince = Math.floor((today - issued) / DAY);
  const base = { type: c.type, issuedOn: c.date, issuedLabel: fmtDay(issued), reviewBy: c.reviewBy, daysSince };
  if (!['Sales', 'Trainer', 'FM Team', 'Recruitment Team', 'PT Team'].includes(e.team)) return { ...base, verdict: 'na', label: 'Not tracked', rows: [], note: 'Nothing is tracked for this team.' };

  const rows = [];

  // Equal runs of days either side of the issue date, kept inside the person's tenure and the feed's history.
  const doj = dojDate(e.doj);
  const feedFloor = (f) => (f instanceof Date ? f : f ? new Date(Math.floor(f / 12), f % 12, 1) : null);
  const dayWindows = (feedStart) => {
    const floors = [doj, feedFloor(feedStart)].filter(Boolean);
    const room = floors.length ? Math.floor((issued - new Date(Math.max(...floors.map((d) => d.getTime())))) / DAY) : MAX_DAYS;
    const n = Math.min(daysSince, MAX_DAYS, room);
    if (n < MIN_DAYS) return { n, reason: daysSince < MIN_DAYS ? `only ${Math.max(daysSince, 0)} day${daysSince === 1 ? '' : 's'} since it was issued` : 'not enough history before it was issued' };
    return { n, before: [addDays(issued, -n), issued], after: [addDays(issued, 1), addDays(issued, 1 + n)] };
  };
  const dated = (key, label, kind, good, records, dateOf, feedStart, weightOf = () => 1) => {
    const w = dayWindows(feedStart);
    if (!w.before) return rows.push(missing(key, label, kind, good, `Needs at least ${MIN_DAYS} days either side — ${w.reason}`));
    const count = ([from, to]) => (records || []).reduce((sum, r) => { const d = toDate(dateOf(r)); return d && d >= from && d < to ? sum + weightOf(r) : sum; }, 0);
    return rows.push(row(key, label, kind, good, count(w.before), count(w.after), `${w.n} days after vs the ${w.n} days before`));
  };

  const impact = computeEventImpact(e, c.date, 3);
  const monthly = (key, label, kind, good) => {
    const m = impact.metrics?.[key];
    if (m) return rows.push(row(key, label, kind, good, m.before, m.after, `${impact.k} full month${impact.k === 1 ? '' : 's'} after vs the ${impact.k} before (the issue month is left out)`));
    return rows.push(missing(key, label, kind, good, impact.tooRecent ? 'Needs one full month after the issue month' : 'Not enough months on file before or after'));
  };
  const index = (key, label) => {
    const details = e[INDEX_FIELDS[key]] || [];
    const m = impact.metrics?.[key];
    if (m) return rows.push(row(key, label, 'rate', 'up', m.before, m.after, `${impact.k} full month${impact.k === 1 ? '' : 's'} after vs the ${impact.k} before`));
    const now = details[details.length - 1];
    return rows.push({ ...missing(key, label, 'rate', 'up', now ? 'History is being built from Nov 2026 — a comparison appears once there are enough saved months' : 'No score yet from Koenig'), current: now ? now.score : null, currentMonth: now?.month || null });
  };

  if (e.team === 'Sales') {
    // Target achievement: the quarter the PA/PIP was issued in vs the current one.
    const qIssue = quarterOf(issued), qNow = quarterOf(today);
    const tIssue = quarterTargetFor(e, 'nr', qIssue);
    const tNow = quarterTargetFor(e, 'nr', qNow);
    const tl = (q) => `${q.name} ${q.year}`;
    if (qIssue.name === qNow.name && qIssue.year === qNow.year) {
      rows.push(missing('target', 'Target achievement', 'pct', 'up', `Issued in the current quarter (${tl(qNow)}) — compared once the next quarter begins`));
    } else if (!tIssue || tIssue.unavailable || !tNow || tNow.unavailable) {
      rows.push(missing('target', 'Target achievement', 'pct', 'up', `No target on file for ${!tIssue || tIssue.unavailable ? tl(qIssue) : tl(qNow)}`));
    } else {
      rows.push(row('target', 'Target achievement', 'pct', 'up', numPct(tIssue.pct), numPct(tNow.pct), `${tl(qIssue)} (issue quarter, ${tIssue.nrLabel} of ${tIssue.targetLabel}) vs ${tl(qNow)} so far (${tNow.nrLabel} of ${tNow.targetLabel})`));
    }
    monthly('trueNr', 'True NR / month', 'money', 'up');
    monthly('nr', 'NR / month', 'money', 'up');
    dated('sc', 'SCs raised', 'count', 'up', e.scDetails, (x) => x.createdOn, FEED_START.sc);
    index('csmIndex', 'CSM Index');
  } else if (e.team === 'Trainer') {
    monthly('util', 'Utilization (avg)', 'percent', 'up');
    dated('assignments', 'Assignments started', 'count', 'up', (e.assignmentsDetails || []).filter((a) => { const d = toDate(a.startDate); return d && d <= today; }), (x) => x.startDate, null);
    dated('neg', 'Negative feedback', 'count', 'down', e.negFeedbackDetails, (x) => x.feedbackDate, FEED_START.negFeedback);
    index('trainerIndex', 'Trainer Index');
  } else if (e.team === 'FM Team') {
    // The FM interviews feed only keeps the last 30 days.
    dated('interviews', 'Interviews', 'count', 'up', e.fmInterviewsDetails, (x) => x.date, addDays(today, -FM_INTERVIEWS_DAYS), (x) => x.count ?? 1);
    index('commonIndex', 'Common Index');
  } else if (e.team === 'Recruitment Team') {
    // The recruiter feed keeps the trailing 6 calendar months.
    dated('interviews', 'Interviews', 'count', 'up', e.recruiterInterviewsDetails, (x) => x.date, new Date(today.getFullYear(), today.getMonth() - 5, 1), (x) => x.count ?? 1);
    index('commonIndex', 'Common Index');
  } else {
    index('commonIndex', 'Common Index');
  }
  // ASM / DM index only for the people who have one.
  if (e.asmIndexDetails?.length) index('asmIndex', 'ASM Index');
  if (e.dmIndexDetails?.length) index('dmIndex', 'DM Index');

  const counted = rows.filter((r) => r.verdict);
  const better = counted.filter((r) => r.verdict === 'better').length;
  const worse = counted.filter((r) => r.verdict === 'worse').length;
  let verdict, label;
  if (!counted.length) { verdict = daysSince < MIN_DAYS ? 'early' : 'nodata'; label = daysSince < MIN_DAYS ? 'Too early' : 'Not enough data'; }
  else if (better > worse) { verdict = 'improved'; label = 'Improved'; }
  else if (worse > better) { verdict = 'declined'; label = 'Declined'; }
  else if (better > 0) { verdict = 'mixed'; label = 'Mixed'; }
  else { verdict = 'same'; label = 'No change'; }
  return { ...base, verdict, label, better, worse, rows, monthly: monthGrid(e, issued, today) };
}

// Month-by-month figures around the issue date for the click-through window:
// three months before the issue month, the issue month, and every month since
// (capped at 10 rows). A month with no data on file shows '—', not 0.
function monthGrid(e, issued, today) {
  const issuedIdx = monthIdxOf(issued);
  const curIdx = monthIdxOf(today);
  const end = curIdx;
  let start = issuedIdx - 3;
  if (end - start + 1 > 10) start = end - 9;
  const dojIdx = dojDate(e.doj) ? monthIdxOf(dojDate(e.doj)) : null;

  const series = (details, field) => {
    const m = new Map();
    for (const d of details || []) { const i = keyIdx(d.month); const v = Number(d[field]); if (i != null && Number.isFinite(v)) m.set(i, v); }
    return (idx) => (m.has(idx) ? m.get(idx) : null);
  };
  // Counts per calendar month; months before the feed's history (or before joining) have no data.
  const counts = (records, dateOf, floorIdx, weightOf = () => 1) => {
    const m = new Map();
    for (const r of records || []) { const d = toDate(dateOf(r)); if (d && d <= today) m.set(monthIdxOf(d), (m.get(monthIdxOf(d)) || 0) + weightOf(r)); }
    const floor = Math.max(floorIdx ?? -Infinity, dojIdx ?? -Infinity);
    return (idx) => (idx < floor ? null : (m.get(idx) || 0));
  };
  const idxMonthAfter = (d) => monthIdxOf(d) + (d.getDate() > 1 ? 1 : 0); // first month the feed covers in full

  let columns;
  if (e.team === 'Sales') {
    columns = [
      { key: 'trueNr', label: 'True NR', kind: 'money', get: series(e.trueNrDetails, 'trueNr') },
      { key: 'nr', label: 'NR', kind: 'money', get: series(e.nrMonthlyDetails, 'nr') },
      { key: 'sc', label: 'SCs raised', kind: 'count', get: counts(e.scDetails, (x) => x.createdOn, FEED_START.sc) },
      { key: 'csmIndex', label: 'CSM Index', kind: 'rate', get: series(e.csmIndexDetails, 'score') },
    ];
  } else if (e.team === 'Trainer') {
    columns = [
      { key: 'util', label: 'Utilization', kind: 'percent', get: series(e.utilMonthlyDetails, 'util') },
      { key: 'assignments', label: 'Assignments started', kind: 'count', get: counts(e.assignmentsDetails, (x) => x.startDate, null) },
      { key: 'neg', label: 'Negative feedback', kind: 'count', get: counts(e.negFeedbackDetails, (x) => x.feedbackDate, FEED_START.negFeedback) },
      { key: 'trainerIndex', label: 'Trainer Index', kind: 'rate', get: series(e.trainerIndexDetails, 'score') },
    ];
  } else if (e.team === 'FM Team') {
    columns = [{ key: 'interviews', label: 'Interviews', kind: 'count', get: counts(e.fmInterviewsDetails, (x) => x.date, idxMonthAfter(addDays(today, -FM_INTERVIEWS_DAYS)), (x) => x.count ?? 1) }];
  } else if (e.team === 'Recruitment Team') {
    columns = [{ key: 'interviews', label: 'Interviews', kind: 'count', get: counts(e.recruiterInterviewsDetails, (x) => x.date, curIdx - 5, (x) => x.count ?? 1) }];
  } else {
    columns = [];
  }
  if (['FM Team', 'Recruitment Team', 'PT Team'].includes(e.team)) columns.push({ key: 'commonIndex', label: 'Common Index', kind: 'rate', get: series(e.commonIndexDetails, 'score') });
  if (e.asmIndexDetails?.length) columns.push({ key: 'asmIndex', label: 'ASM Index', kind: 'rate', get: series(e.asmIndexDetails, 'score') });
  if (e.dmIndexDetails?.length) columns.push({ key: 'dmIndex', label: 'DM Index', kind: 'rate', get: series(e.dmIndexDetails, 'score') });

  const months = [];
  for (let idx = start; idx <= end; idx++) {
    const tag = idx < issuedIdx ? 'before' : idx === issuedIdx ? 'issued' : idx === curIdx ? 'current' : 'after';
    months.push({ idx, label: MONTH_LABEL(idx), tag, values: Object.fromEntries(columns.map((c) => [c.key, c.get(idx)])) });
  }
  return { columns: columns.map(({ key, label, kind }) => ({ key, label, kind })), months };
}
