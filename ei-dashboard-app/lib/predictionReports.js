// Weekly (Wednesday) Trainer + Sales reports: "PA Algo today and 30-day Worry Index prediction".
// Same content as the 5 Nov 2026 versions (Trainers v4 — resigned excluded, Sales v3), rebuilt from live data, with:
//   - the "PA/PIP status today" column removed: people whose PA/PIP is RUNNING today (inside its issued..review-by window)
//     are highlighted instead (yellow = PA, orange = PIP);
//   - the "Level (suggested)" cell says why a person is High concern / Watch (the points that put them there).
// "Suggested" Worry Index = the dashboard's signals re-weighted by the 27 Oct back-test (rules written out in the report text).
import ExcelJS from 'exceljs';
import { getEmployees } from './queries.js';
import { computeSignalReport } from './data.js';
import { PAST_ML } from './pastMl.js';
import { displayDateToIso } from './analysis.js';
import { parseDoj, quarterOf } from './performanceSummary.js';
import { quarterTrueNr } from './quarterTrueNr.js';
import { TRAINER_SALARY_TIERS } from './paAlgo.js';

const DAY = 86400000;
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON_TITLE = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ML = new Set(PAST_ML.cases.map((c) => c.id));
const r1 = (n) => Math.round(n * 10) / 10;

// ---------- small helpers ----------
const keyIdx = (k) => { const m = /^([A-Za-z]{3})[a-z]*[-\s](\d{4})$/.exec(String(k || '').trim()); if (!m) return null; const mi = MON.indexOf(m[1].toLowerCase()); return mi < 0 ? null : +m[2] * 12 + mi; };
const dateIdx = (d) => d.getFullYear() * 12 + d.getMonth();
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const dm = /^(\d{1,2})-([A-Za-z]{3})[a-z]*-(\d{4})/.exec(s);
  const d = dm ? new Date(+dm[3], MON.indexOf(dm[2].toLowerCase()), +dm[1], 12) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
const istDateString = (d) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
const longDate = (d) => { const [y, m, dd] = istDateString(d).split('-'); return `${Number(dd)} ${MON_TITLE[Number(m) - 1]} ${y}`; };
const shortDate = (d) => { const [, m, dd] = istDateString(d).split('-'); return `${Number(dd)} ${MON_TITLE[Number(m) - 1]}`; };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A PA/PIP counts as "on" only while today sits inside its own issued..review-by window (Koenig leaves lapsed cases flagged).
function runningPaPip(e, todayIso) {
  const want = e.status === 'PIP Issued' ? 'PIP' : e.status === 'PA Issued' ? 'PA' : null;
  if (!want) return null;
  return (e.pipHistory || []).some((p) => {
    if (p.type !== want) return false;
    const from = displayDateToIso(p.issuedOn), to = displayDateToIso(p.reviewBy);
    return !!from && !!to && from <= todayIso && todayIso <= to;
  }) ? (want === 'PIP' ? 'PIP Issued' : 'PA Issued') : null;
}

const LEVELS = {
  Sales: { high: -9, watch: -6 },   // High concern ≤ −9, Watch ≤ −6, else OK
  Trainer: { high: -9, watch: -4 }, // High concern ≤ −9, Watch ≤ −4, else OK
};
const levelOf = (team, wi) => (wi <= LEVELS[team].high ? 'High concern' : wi <= LEVELS[team].watch ? 'Watch' : 'OK');
const LEVEL_FILL = { 'High concern': 'F8CBAD', Watch: 'FFF2CC', OK: 'E2EFDA' };
const STATUS_FILL = { 'PA Issued': 'FFD966', 'PIP Issued': 'F4B183' };

const DISPLAY = {
  'Manager feedback below average (last feedback)': 'Manager feedback below average',
  'Weekly progress email not received': 'Weekly email not received',
  'Weekly response quality (AI rating)': 'Weekly response quality',
  'Low RMS activity (under 5 clicks a day)': 'Low RMS activity',
  'No emails sent (low email activity)': 'Low email activity',
  'Zero assignments since joining, including future': 'Zero assignments since joining',
};
const fmtPts = (p) => (p > 0 ? `+${r1(p)}` : `${r1(p)}`);

// A copy of the employee as it stood on date T (dated lists cut at T, tenure shifted back) — used for the "30 days before" score.
function asOf(e, T) {
  const cut = (list, field) => (list || []).filter((r) => { const d = parseDate(r[field]); return d && d <= T; });
  const lastIdx = dateIdx(T) - 1;
  const months = (det) => (det || []).filter((d) => { const i = keyIdx(d.month); return i != null && i <= lastIdx; });
  return {
    ...e,
    tenure: Math.max(0, (e.tenure ?? 0) - Math.round((Date.now() - T.getTime()) / DAY)),
    nrMonthlyDetails: months(e.nrMonthlyDetails), trueNrDetails: months(e.trueNrDetails), utilMonthlyDetails: months(e.utilMonthlyDetails),
    scDetails: cut(e.scDetails, 'createdOn'), negFeedbackDetails: cut(e.negFeedbackDetails, 'feedbackDate'),
    rcMainAssignmentsDetails: cut(e.rcMainAssignmentsDetails, 'startDate'), mgrFeedbackDetails: cut(e.mgrFeedbackDetails, 'date'),
    skillsDetails: cut(e.skillsDetails, 'skillAvailableDate'), inHouseSkillsDetails: cut(e.inHouseSkillsDetails, 'markDate'),
    shoddyNegDetails: cut(e.shoddyNegDetails, 'reportedDate'), shoddyPosDetails: cut(e.shoddyPosDetails, 'reportedDate'),
    weeks: (e.weeks || []).filter((w) => !w.week || w.week <= isoWeekKey(T)),
  };
}
function isoWeekKey(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear(); const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

// Tenure as "4 months 15 days"; once a year is complete, "1 year 4 months".
function tenureText(e, now) {
  const doj = parseDoj(e.doj);
  if (!doj) return '';
  const [ay, am, ad] = doj.split('-').map(Number);
  const [by, bm, bd] = istDateString(now).split('-').map(Number);
  let y = by - ay, m = bm - am, d = bd - ad;
  if (d < 0) { m--; d += new Date(by, bm - 1, 0).getDate(); }
  if (m < 0) { y--; m += 12; }
  const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (y >= 1) return m ? `${pl(y, 'year')} ${pl(m, 'month')}` : pl(y, 'year');
  const parts = [];
  if (m) parts.push(pl(m, 'month'));
  if (d || !m) parts.push(pl(d, 'day'));
  return parts.join(' ');
}
const tenureMonths = (e, now) => { const doj = parseDoj(e.doj); return doj ? (now - new Date(doj + 'T12:00:00')) / DAY / 30.4 : 99; };
const dmy = (d) => `${d.getDate()} ${MON_TITLE[d.getMonth()]}`;
// The inputs behind a dashboard signal's points, so each reason can be checked against the source.
function sigData(e, s, since) {
  if (/^Weekly response quality/.test(s.label)) {
    const k = isoWeekKey(since);
    const r = (e.weeks || []).filter((w) => Number.isFinite(w.aiRating) && (w.week || '') >= k).map((w) => `${String(w.week).slice(-3)} ★${w.aiRating}`);
    return r.length ? `weekly check-in AI ratings (★5 +2, ★4 +1, ★3 0, ★2 −1, ★1 −2): ${r.join(', ')}` : '';
  }
  if (s.label === 'Weekly progress email not received') return `${s.count} weekly check-in(s) not received`;
  const parts = [];
  if (s.count != null) parts.push(`${s.count} × ${r1(s.pts / s.count)}`);
  if (s.detail) parts.push(s.detail);
  return parts.join('; ');
}

// ---------- scoring: the dashboard's signals, re-weighted ----------
// Returns { noScore, wi, parts:[{label, pts}], extras }. `T` is the date the score is "as of"; `isToday` switches on the NR outlook
// (booked revenue ahead is only known for today).
// True NR the API already returns for the 2 months after T's month (forward-booked revenue net of cost); a missing month counts 0.
function upcomingTrueNr(e, T) {
  const i = dateIdx(T);
  return [i + 1, i + 2].reduce((sum, idx) => {
    const m = (e.trueNrFutureDetails || []).find((d) => keyIdx(d.month) === idx && Number.isFinite(Number(d.trueNr)));
    return sum + (m ? Number(m.trueNr) : 0);
  }, 0);
}
// Target achievement (Koenig True NR vs the quarter's CSM target, one definition: lib/quarterTrueNr.js).
// Strong performer: reached 75% of the target at ANY point of the running quarter (cumulative True NR at any month-end, API months incl. forward-booked)
// AND finished the previous quarter at 75% or more -> never High concern.
function strongAchiever(e, T) {
  const cur = quarterOf(istDateString(T));
  const prev = cur.name === 'Q1' ? { name: 'Q4', year: cur.year - 1 } : { name: `Q${Number(cur.name.slice(1)) - 1}`, year: cur.year };
  const tgt = (q) => (e.quarterTargets || []).find((t) => t.name === q.name && t.year === q.year && t.type !== 'ASM' && t.amount > 0);
  const tc = tgt(cur), tp = tgt(prev);
  if (!tc || !tp) return null;
  const c = quarterTrueNr(e, cur), pq = quarterTrueNr(e, prev);
  if (!c.monthsAvailable || !pq.monthsAvailable) return null;
  let run = 0, peak = -Infinity;
  for (const m of c.months) if (m.trueNr != null) { run += m.trueNr; peak = Math.max(peak, run); }
  const curPct = Math.round((peak / tc.amount) * 100), prevPct = Math.round((pq.total / tp.amount) * 100);
  return curPct >= 75 && prevPct >= 75 ? { curPct, prevPct, note: `Target ${cur.name} peak ${curPct}% and ${prev.name} ${prevPct}% (both 75%+) → SC / True NR points set aside, max Watch` } : null;
}
const upMonths = (T) => [1, 2].map((k) => MON_TITLE[(dateIdx(T) + k) % 12]).join(' + ');

export function suggestedScore(e, T, { isToday, variant = 'old' }) {
  const VC = variant === 'new' || variant === 'checkin', VS = variant === 'new' || variant === 'sc', VN = variant === 'new' || variant === 'nr';
  const V2 = VC || VS || VN; // candidate weights: check-ins soft, SCs strong, True NR on completed months + trend credit (Sales)
  const team = e.team;
  const doj = parseDoj(e.doj);
  const dojDate = doj ? new Date(doj + 'T12:00:00') : new Date(Date.now() - (e.tenure ?? 0) * DAY);
  const monitor = new Date(dojDate); monitor.setMonth(monitor.getMonth() + 1); // training month is not scored
  if (T < monitor) return { noScore: true };
  const firstMonthIdx = dateIdx(monitor);
  // Trainers: every signal counted from the end of the training month up to T (all-time, as the 5 Nov Trainer report did);
  // Sales: the last 90 days.
  const since = new Date(Math.max(T.getTime() - 91 * DAY, monitor.getTime()));
  const parts = [];
  const add = (label, pts, extra) => { if (pts) parts.push({ label, pts, ...extra }); };
  // Trainers: the dashboard's all-time signals as they stood at T (no window); Sales: the 90-day window.
  const sigs = computeSignalReport(e, { since, until: T }).filter((s) => s.status === 'fired');
  const last = dateIdx(T) - 1; // last completed month
  const extras = {};

  // --- new signals first (they lead the reasons) ---
  if (team === 'Trainer') {
    const tenMo = (T - dojDate) / DAY / 30.4; // months since joining at T: a new joiner is not expected to be highly utilised
    const u = (e.utilMonthlyDetails || []).map((d) => ({ i: keyIdx(d.month), v: Number(d.util) })).filter((d) => d.i != null && d.i <= last && d.i >= Math.max(last - 2, dateIdx(dojDate)) && Number.isFinite(d.v));
    if (u.length) {
      const avg = u.reduce((s, d) => s + d.v, 0) / u.length;
      extras.util3 = r1(avg);
      const uPts = tenMo < 2 ? 0 : tenMo < 6 ? (avg < 15 ? -6 : avg < 25 ? -3 : 0) : (avg < 30 ? -6 : avg < 40 ? -3 : 0);
      const uRule = tenMo < 2 ? 'first 2 months: not penalised' : tenMo < 6 ? '2–6 months: under 15% = −6, 15–25% = −3' : 'under 30% = −6, 30–40% = −3';
      add(`Utilization ${Math.round(avg)}% (3-mo avg)`, uPts, { data: `${u.map((d) => `${MON_TITLE[d.i % 12]} ${r1(d.v)}%`).join(', ')} → average ${r1(avg)}% (${uRule})` });
    }
    // No SC utilization in the last completed month (assignment counts are not used: an assignment can be 4 hours or a week).
    const lm = (e.utilMonthlyDetails || []).find((d) => keyIdx(d.month) === last);
    if (lm && lm.scUtil != null && Number.isFinite(Number(lm.scUtil)) && last >= firstMonthIdx && tenMo >= 2) {
      const sc = Number(lm.scUtil);
      extras.scUtilLast = r1(sc);
      add('No SC utilization in the last month', sc <= 0 ? -3 : 0, { data: `${MON_TITLE[last % 12]} SC utilization ${r1(sc)}% (0% = −3; not applied in the first 2 months)` });
    }
  }

  // --- dashboard signals, re-weighted ---
  for (const s of sigs) {
    const L = s.label;
    let pts = s.pts;
    if (team === 'Sales') {
      if (L === 'Tech calls' || L === 'Tech calls < 1 per week' || L === 'External meetings < 1 per week') continue; // 0 / on hold
      if (L === 'Negative enquiry audit') pts = -5 * Math.min(s.count || 1, 2); // −5 each, capped −10
      if (L === 'Weekly progress email not received') pts = Math.max(pts, -6);
      if (VC && /^Weekly response quality/.test(L) && pts < 0) pts = Math.max(-3, pts / 2); // soft signal: half weight, capped at -3
    } else {
      if (L === 'Tech calls converted' || L === 'Polls participated') continue; // 0
      // Not counted in the Trainer prediction (they swamp the score; matches the 5 Nov Trainer report): skills-shortfall penalty, positive HR incidents.
      if (L === 'Skills count < weeks since joining' || L === 'HR incidents (positive)' || L === 'Zero assignments since joining, including future') continue;
      if (L === 'Marking course inhouse') pts = Math.min(pts, 5); // capped +5
      if (L === 'Negative feedback on delivery') pts = -2 * (s.count || 1);
      if (L === 'Manager feedback below average (last feedback)') pts = -2;
    }
    add(DISPLAY[L] || L, pts, { data: sigData(e, s, since) });
  }

  if (team === 'Sales') {
    // Negative HR incidents in the window: −2 each, capped −4
    const negList = (e.shoddyNegDetails || []).filter((x) => { const d = parseDate(x.reportedDate); return d && d >= since && d <= T; });
    const neg = negList.length;
    add('Negative HR incidents (90 days)', -2 * Math.min(neg, 2), { data: `${neg} incident(s) since ${dmy(since)}: ${negList.map((x) => `${x.reportedDate} ${x.reason || ''}`.trim()).join('; ')} (−2 each, max −4)` });
    // SCs per 30 days (needs ≥ 3 weeks of monitoring; a shorter window is scaled to 30 days)
    const scFrom = new Date(Math.max(T.getTime() - 30 * DAY, monitor.getTime()));
    const scDays = Math.round((T - scFrom) / DAY);
    let scPts = 0;
    if (scDays >= 21) {
      const scList = (e.scDetails || []).map((x) => parseDate(x.createdOn)).filter((d) => d && d > scFrom && d <= T).sort((a, b) => b - a);
      const n = scList.length;
      const per30 = n * 30 / scDays;
      extras.sc30 = r1(per30);
      const tenured = (T - dojDate) / DAY / 30.4 >= 6;
      if (variant === 'old_sc') scPts = per30 < 3 ? -6 : per30 < 8 ? -3 : 0;
      else scPts = per30 < 2 ? -6 : (tenured && per30 < 4) ? -3 : 0; // under 2 = -6; under 4 = -3 only beyond the first 6 months
      parts.push({ label: `SCs ${r1(per30)} per 30 days`, pts: scPts, sc: true, data: `${n} SC(s) raised ${dmy(scFrom)}–${dmy(T)}${n ? ': ' + scList.map(dmy).join(', ') : ''} (under 2 = −6; under 4 = −3 for people past 6 months; otherwise 0)` });
    }
    // True NR, this month + the 2 before (HR's rule), average in ₹L
    const t = (e.trueNrDetails || []).map((d) => ({ i: keyIdx(d.month), v: Number(d.trueNr) })).filter((d) => d.i != null && (VN ? d.i <= last && d.i >= Math.max(last - 2, firstMonthIdx) : d.i <= last + 1 && d.i >= Math.max(last - 1, firstMonthIdx)) && Number.isFinite(d.v));
    let tPts = 0;
    if (t.length) {
      const avgL = t.reduce((s, d) => s + d.v, 0) / t.length / 1e5;
      extras.tnrAvgL = r1(avgL);
      tPts = avgL < 0 ? -6 : avgL < 5 ? -3 : 0;
      const joiner = (T - dojDate) / DAY / 30.4 < 6; // first 6 months from joining: graded bands, low-but-positive NR is normal
      if (joiner && variant !== 'old_nr') tPts = avgL < 0 ? -6 : avgL < 3 ? -3 : 0;
      if (variant === 'joiner' && tPts === -3 && (T - dojDate) / DAY / 30.4 < 6) tPts = 0; // candidate: first 6 months, only a negative average is penalised
      if (VN) { const lastM = t.find((d) => d.i === last); if (lastM && lastM.v >= 5e5) tPts = 0; } // trend credit: last completed month at least ₹5 L
      parts.push({ label: `True NR avg ₹${r1(avgL)} L`, pts: tPts, tnr: true, data: `${t.map((d) => `${MON_TITLE[d.i % 12]} ₹${r1(d.v / 1e5)} L`).join(', ')} → average ₹${r1(avgL)} L (current month counts; ${joiner ? 'joiner, first 6 months: negative = −6, under ₹3 L = −3' : 'negative = −6, under ₹5 L = −3'})` });
    }
    // True NR direction (display only, not scored): last completed month vs the one before, with the current month so far for context.
    {
      const mm = (i) => (e.trueNrDetails || []).find((d) => keyIdx(d.month) === i && Number.isFinite(Number(d.trueNr)));
      const a = mm(last - 1), b = mm(last), c = mm(last + 1);
      if (a && b) {
        const diff = (Number(b.trueNr) - Number(a.trueNr)) / 1e5;
        const lbl = diff >= 1 ? 'Improving' : diff <= -1 ? 'Declining' : 'Steady';
        const L = (d) => `${MON_TITLE[keyIdx(d.month) % 12]} ₹${r1(Number(d.trueNr) / 1e5)} L`;
        extras.nrTrend = `${lbl}: ${L(a)} → ${L(b)}${c ? ` (${L(c)} so far)` : ''}`;
      }
    }
    // NR outlook: Koenig's True NR for the next 2 months (straight from the API) ≥ ₹2 L → True NR and SC points dropped, level at most Watch
    if (isToday) {
      const booked = upcomingTrueNr(e, T);
      extras.bookedL = r1(booked / 1e5);
      extras.outlook = booked >= 2e5 ? 'On track' : 'Behind';
      if (extras.outlook === 'On track') for (let i = parts.length - 1; i >= 0; i--) if (parts[i].sc || parts[i].tnr) parts.splice(i, 1);
    }
  }
  // Strong achievers (75%+ of target at any point this quarter and last quarter): the hard signals (SCs, True NR) are set aside,
  // so only the soft factors (check-ins, manager feedback, HR incidents, ...) can put them on Watch.
  const sa = team === 'Sales' && isToday ? strongAchiever(e, T) : null;
  if (sa) for (let i = parts.length - 1; i >= 0; i--) if (parts[i].sc || parts[i].tnr) parts.splice(i, 1);
  const clean = parts.filter((p) => p.pts);
  const wi = r1(clean.reduce((s, p) => s + p.pts, 0) + 0);
  if (sa) extras.targetNote = sa.note;
  const wiNoEmail = r1(clean.filter((p) => p.label !== (DISPLAY['Weekly progress email not received'] || 'Weekly progress email not received')).reduce((s, p) => s + p.pts, 0));
  return { noScore: false, wi, wiNoEmail, emailSoft: team === 'Trainer', parts: clean, extras, capWatch: team === 'Sales' && isToday && (extras.outlook === 'On track' || !!sa) };
}
function levelFor(team, sc) {
  if (!sc || sc.noScore) return 'No score';
  let lv = levelOf(team, sc.wi);
  if (sc.capWatch && lv === 'High concern') lv = 'Watch';
  // Trainers: missed weekly emails are a soft signal — they count in full, but cannot by themselves make someone High concern.
  if (sc.emailSoft && lv === 'High concern' && levelOf(team, sc.wiNoEmail) !== 'High concern') lv = 'Watch';
  return lv;
}
// Forecast = today's suggested score read forward (the 27 Oct back-test: a bad score today flags most people who get a PA/PIP ~30 days later).
const forecastDay = (now) => shortDate(new Date(now.getTime() + 30 * DAY));
const FORECAST_TEXT = { 'High concern': 'High concern', Watch: 'Watch — at risk of becoming one', OK: 'OK — not expected', 'No score': 'Not scored yet (training month)' };
const forecastLabel = (p) => FORECAST_TEXT[p.level] || p.level;
// Direction since 30 days ago (look-back, shown only as supporting context).
function trendOf(p) {
  if (p.sc30.noScore) return 'New — not scored 30 days ago';
  const arrow = `${p.sc30.wi} → ${p.sc.wi}`;
  const d = r1(p.sc.wi - p.sc30.wi);
  return d <= -3 ? `Worsening (${arrow})` : d >= 3 ? `Improving (${arrow})` : `Steady (${arrow})`;
}
const dataText = (sc) => (sc && !sc.noScore ? sc.parts.filter((p) => p.pts < 0 && p.data).map((p) => `${p.label}: ${p.data}`).join(' | ') : '');
const reasonText = (sc) => (sc && !sc.noScore ? sc.parts.filter((p) => p.pts < 0).sort((a, b) => 0).map((p) => `${p.label} (${fmtPts(p.pts)})`).join('; ') : '');

// ---------- evidence bullets (what the PA Algo fired on) ----------
function evidenceText(e, algo) {
  const bullets = [];
  const mon = (m) => String(m).slice(0, 3);
  const bracket = (ev, n, col) => { const rows = (ev.rows || []).slice(-n); return rows.length ? ` [${rows.map((r) => `${mon(r[0])} ${r[col]}`).join(', ')}]` : ''; };
  for (const ev of algo.evidence || []) {
    const label = ev.label || '';
    const summary = ev.summary || '';
    let m;
    if (e.team === 'Trainer') {
      if (/^Main Trainer assignments/.test(label)) { bullets.push(`Main-trainer assignments: ${summary}`); continue; }
      if ((m = /^Utilization .* — trailing (\d+) days/.exec(label))) { bullets.push(`Utilization, last ${m[1]} days: ${summary}${bracket(ev, 6, 3)}`); continue; }
      if ((m = /^Negative-feedback assignments — trailing (\d+) days/.exec(label))) { bullets.push(`Negative-feedback assignments, last ${m[1]} days: ${summary}`); continue; }
    } else {
      if (/^Most recent SCs on file/.test(label)) {
        bullets.push(`Zero SCs in last 30 days — ${/^No SCs on file at all/.test(summary) ? summary : `Most recent SC: ${(ev.rows && ev.rows[0] && ev.rows[0][1]) || summary}`}`);
        continue;
      }
      if (/^True NR since joining/.test(label)) { bullets.push(`True NR since joining below the bar: ${summary}${bracket(ev, 4, 1)}`); continue; }
      if (/^True NR — trailing 3 months/.test(label)) { bullets.push(`Negative True NR over last 3 months: ${summary}${bracket(ev, 4, 1)}`); continue; }
      if (/^NR — trailing 12 months/.test(label)) { bullets.push(`Avg NR, last 12 months, below the bar: ${summary}${bracket(ev, 4, 1)}`); continue; }
      if (/^NR — all months since joining/.test(label)) { bullets.push(`Avg NR since joining below the bar: ${summary}${bracket(ev, 4, 1)}`); continue; }
    }
    bullets.push(summary ? `${label}: ${summary}` : label);
  }
  return bullets.map((b) => `• ${b}`).join(String.fromCharCode(10));
}

// ---------- pools ----------
const isAsm = (e) => e.designation === 'Assistant Sales Manager' || (e.quarterTargets || []).some((t) => t.type === 'ASM');
const isAtm = (e) => e.designation === 'Assistant Technical Manager';
const TIER = { [TRAINER_SALARY_TIERS.UNDER_125K]: 'Under ₹1.25 L', [TRAINER_SALARY_TIERS.BETWEEN_125K_200K]: '₹1.25–2 L', [TRAINER_SALARY_TIERS.OVER_200K]: 'Over ₹2 L' };

function utilByMonth(e, idx) {
  const m = (e.utilMonthlyDetails || []).find((d) => keyIdx(d.month) === idx);
  return m && m.util != null ? r1(Number(m.util)) : null;
}

export async function buildReportData({ now = new Date(), employees, excludeIds = [] } = {}) {
  const skip = new Set(excludeIds); // people HR asked to leave out of a particular send
  const all = (employees || (await getEmployees())).filter((e) => !skip.has(e.id));
  const todayIso = istDateString(now);
  const T = now;
  const T30 = new Date(now.getTime() - 30 * DAY);
  const out = {};
  for (const team of ['Trainer', 'Sales']) {
    const algoKey = team === 'Trainer' ? 'trainerPaAlgo' : 'salesPaAlgo';
    const pool = all.filter((e) => e.team === team && (team === 'Trainer' ? !isAtm(e) : !isAsm(e)) && e[algoKey] && !ML.has(e.id) && e.active !== false && (team === 'Sales' || !e.resignedOn));
    const people = pool.map((e) => {
      const onStatus = runningPaPip(e, todayIso); // 'PA Issued' | 'PIP Issued' | null — running today
      const sc = suggestedScore(e, T, { isToday: true });
      const sc30 = suggestedScore(e, T30, { isToday: false });
      return { e, algo: e[algoKey], onStatus, sc, level: levelFor(team, sc), sc30, level30: sc30.noScore ? 'No score' : levelFor(team, sc30) };
    });
    const fired = people.filter((p) => p.algo.status === 'fired').sort((a, b) => (a.onStatus ? 1 : 0) - (b.onStatus ? 1 : 0) || a.e.name.localeCompare(b.e.name));
    const notOn = people.filter((p) => !p.onStatus && !p.sc.noScore).sort((a, b) => a.sc.wi - b.sc.wi);
    const notOnNoScore = people.filter((p) => !p.onStatus && p.sc.noScore);
    out[team] = { pool: people.length, fired, notOn: [...notOn, ...notOnNoScore], T, T30 };
  }
  return { ...out, now, todayIso };
}

// ---------- rendering: email HTML ----------
const TH = 'background:#3F4A8A;color:#fff;padding:6px;border:1px solid #ccc;font-size:12px;text-align:left';
const TD = 'padding:5px;border:1px solid #ddd;font-size:12px;vertical-align:top';
const table = (heads, rows) => `<table style="border-collapse:collapse;font-family:Segoe UI,Arial"><tbody><tr>${heads.map((h) => `<th style="${TH}">${esc(h)}</th>`).join('')}</tr>${rows.join('')}</tbody></table>`;
const cell = (v, extra = '') => `<td style="${TD}${extra}">${v}</td>`;
const levelCell = (p) => {
  const lv = p.level;
  const base = LEVEL_FILL[lv] ? `;background:#${LEVEL_FILL[lv]}` : '';
  const why = (lv === 'High concern' || lv === 'Watch') ? `<div style="font-size:11px;color:#444;margin-top:3px">${esc(reasonText(p.sc))}</div>` : '';
  return cell(`<b>${esc(lv)}</b>${why}`, base);
};
const rowFill = (p) => (p.onStatus ? `;background:#${STATUS_FILL[p.onStatus]}` : '');
const nl = (s) => esc(s).replace(/\n/g, '<br/>');

function trainerMonths(now) {
  const i = dateIdx(now);
  const mk = (idx) => ({ idx, name: MON_TITLE[((idx % 12) + 12) % 12] });
  return { m3: [i - 3, i - 2, i - 1].map(mk), cur: mk(i) };
}

function trainerPart1Rows(data, now) {
  const { m3, cur } = trainerMonths(now);
  return data.Trainer.fired.map((p) => {
    const e = p.e;
    const fill = rowFill(p);
    const c = (v) => cell(v == null ? '' : esc(v), fill);
    const curUtil = utilByMonth(e, cur.idx);
    return `<tr>${c(e.name)}${c(e.manager || '—')}${c(p.algo.band)}${cell(nl(evidenceText(e, p.algo)), fill)}${m3.map((m) => c(utilByMonth(e, m.idx))).join('')}${c(curUtil)}${levelCell({ ...p })}</tr>`;
  });
}
function mainLast60(e, now) {
  const from = new Date(now.getTime() - 60 * DAY);
  return (e.rcMainAssignmentsDetails || []).filter((a) => { const d = parseDate(String(a.startDate || '').split(' ')[0]); return d && d > from && d <= now; }).length;
}
function trainerPart2Rows(list, data, label30) {
  const firedIds = new Set(data.Trainer.fired.map((p) => p.e.id));
  return list.map((p) => {
    const e = p.e;
    const c = (v, extra = '') => cell(v == null ? '' : esc(v), extra);
    const lvFill = LEVEL_FILL[p.level] ? `;background:#${LEVEL_FILL[p.level]}` : '';
    return `<tr>${c(e.name)}${c(e.manager || '—')}${c(tenureText(e, data.now))}${c(p.sc.noScore ? '' : p.sc.wi)}${c(forecastLabel(p), lvFill)}${c(p.sc.extras?.util3 ?? '')}${c(reasonText(p.sc) || '—')}${c(firedIds.has(e.id) ? 'Yes' : 'No')}</tr>`;
  });
}

function salesPart1Rows(data) {
  return data.Sales.fired.map((p) => {
    const e = p.e;
    const fill = rowFill(p);
    const c = (v) => cell(v == null ? '' : esc(v), fill);
    const m = salesFacts(e, data.now);
    return `<tr>${c(e.name)}${c(e.manager || '—')}${c(p.algo.band)}${cell(nl(evidenceText(e, p.algo)), fill)}${c(m.sc30)}${c(m.lastSc)}${c(m.tnr3)}${c(m.booked)}${levelCell(p)}</tr>`;
  });
}
function salesFacts(e, now) {
  const scDates = (e.scDetails || []).map((s) => parseDate(s.createdOn)).filter(Boolean).sort((a, b) => b - a);
  const i = dateIdx(now);
  const tnr = (e.trueNrDetails || []).map((d) => ({ i: keyIdx(d.month), v: Number(d.trueNr) })).filter((d) => d.i != null && d.i <= i && d.i >= i - 2 && Number.isFinite(d.v));
  return {
    sc30: scDates.filter((d) => now - d <= 30 * DAY).length,
    lastSc: scDates[0] ? istDateString(scDates[0]) : 'None on file',
    tnr3: tnr.map((d) => `${MON_TITLE[d.i % 12]} ${r1(d.v / 1e5)}`).join(', '),
    booked: r1(upcomingTrueNr(e, now) / 1e5),
  };
}
function salesPart2Rows(list, data) {
  const firedIds = new Set(data.Sales.fired.map((p) => p.e.id));
  return list.map((p) => {
    const e = p.e;
    const c = (v, extra = '') => cell(v == null ? '' : esc(v), extra);
    const lvFill = LEVEL_FILL[p.level] ? `;background:#${LEVEL_FILL[p.level]}` : '';
    const x = p.sc.extras || {};
    return `<tr>${c(e.name)}${c(e.manager || '—')}${c(p.sc.noScore ? '' : p.sc.wi)}${c(forecastLabel(p), lvFill)}${c(x.sc30 ?? '')}${c(x.tnrAvgL ?? '')}${c(x.bookedL ?? '')}${c([x.outlook, x.targetNote].filter(Boolean).join(' · '))}${c(reasonText(p.sc) || '—')}${c(firedIds.has(e.id) ? 'Yes' : 'No')}</tr>`;
  });
}

function legend(team) {
  return `<p>Rows highlighted <span style="background:#FFD966;padding:1px 6px">yellow</span> are on a <b>PA</b> and <span style="background:#F4B183;padding:1px 6px">orange</span> on a <b>PIP</b> that is running today (today falls between its issue date and review-by date). Rows without a highlight have no PA/PIP running.</p>`;
}

export function buildTrainerEmail(data, { greeting = 'Hi team,' } = {}) {
  const now = data.now;
  const { m3, cur } = trainerMonths(now);
  const t = data.Trainer;
  const d30 = shortDate(t.T30); const fd = forecastDay(now);
  const concern = t.notOn.filter((p) => p.level === 'High concern' || p.level === 'Watch');
  const lowUtilOk = t.notOn.filter((p) => p.level === 'OK' && (p.sc.extras?.util3 ?? 100) < 30 && tenureMonths(p.e, now) >= 6);
  const onPa = t.fired.filter((p) => p.onStatus);
  const subject = `Trainers — PA Algo today and 30-day Worry Index prediction (${longDate(now)})`;
  const html = `<div style="font-family:Segoe UI,Arial;font-size:13px"><p>${esc(greeting)}</p>`
    + `<p>Trainer report as of ${longDate(now)}. The full version (every trainer, every column) is attached.</p>`
    + `<h3 style="color:#3F4A8A">1. PA Algo firing today — ${t.fired.length} trainers (${onPa.length} on a running PA/PIP)</h3>${legend('Trainer')}`
    + table(['Employee', 'Manager', 'Tenure band', 'What fired (with data)', `Util ${m3[0].name} %`, `Util ${m3[1].name} %`, `Util ${m3[2].name} %`, `Util ${cur.name} % (booked so far)`, 'Level (suggested) — reason if High concern / Watch'], trainerPart1Rows(data, now))
    + `<h3 style="color:#3F4A8A">2. Prediction — trainers not on a running PA/PIP</h3>`
    + `<p>The prediction column is today's suggested score read forward 30 days (to ${fd}). Suggested Trainer Worry Index; High concern = −9 or below, Watch = −4 to −9. Utilization is judged by tenure: under 2 months is not penalised, 2–6 months uses lower bars, 6 months and over uses the standard bars (see section 3). Back-test (Mar–Oct 2026, a score every 14 days, PA/PIP within the next 30 days): 35% of the cases that got a PA/PIP were on High concern or Watch, against 15% of those that did not. Below: High concern and Watch only (${concern.length}) — the full list is in the attachment. Early-warning list for a manager check-in, not a recommendation to issue a PA/PIP.${lowUtilOk.length ? ` Caution: ${lowUtilOk.length} trainer${lowUtilOk.length === 1 ? '' : 's'} with utilization under 30% still score OK because skills / exam / course-marking points outweigh it (${lowUtilOk.map((p) => esc(p.e.name)).join(', ')}).` : ''}</p>`
    + table(['Employee', 'Manager', 'Tenure', 'Suggested WI today', `Prediction for ${fd} (30 days ahead)`, 'Utilization, last 3 completed months %', 'Main reasons today'], trainerPart2Rows(concern, data).map((r) => r.replace(/<td[^>]*>(Yes|No)<\/td><\/tr>$/, '</tr>')))
    + trainerWeightsSection()
    + `<p style="color:#666;font-size:11px">Generated from the EI dashboard data. Assistant Technical Managers, trainers on maternity leave and resigned trainers are excluded.</p></div>`;
  return { subject, html };
}

// The weights behind the Trainer suggested score (dashboard weight vs the weight used here), for the email and the workbook.
const TRAINER_WEIGHT_ROWS = [
    ['Utilization — average of the last 3 completed months (SC + non-SC hours)', 'not scored', '6 months and over: below 30% = −6, 30–40% = −3. 2–6 months: below 15% = −6, 15–25% = −3. First 2 months: not penalised'],
    ['Negative feedback on delivery', '−5 each', '−2 each'],
    ['Manager feedback below average (latest rated feedback)', '−5', '−2'],
    ['Weekly response quality (AI rating of each weekly check-in)', '+2 to −2 per response', '★5 +2, ★4 +1, ★3 0, ★2 −1, ★1 −2 (same)'],
    ['Weekly progress email not received', '−2 each', '−2 each, not capped — but a soft signal: it can put a trainer on Watch, never on High concern by itself (High concern needs −9 or below from the other signals)'],
    ['Failure in exam / Passed exam', '−5 / +1', 'same'],
    ['No SC utilization in the last completed month (replaces the main-trainer count and zero-assignments points)', 'zero assignments −1', '0% SC utilization = −3 (not in the first 2 months)'],
    ['Marking course in-house', '+0.5 each', 'capped at +5 in total'],
    ['Skills count below weeks since joining; positive HR incidents', '−0.5 / +3', 'not counted'],
    ['Tech calls converted; polls participated', '+5 / +0.1', '0'],
    ['Other positives: TBTs requested +1, applied for KGT +1, ideas for improvement +1, F2F attended +1, F2F presenter +0.5; low RMS activity and no emails sent 0 to −2 each', 'as listed', 'same'],
];
function trainerWeightsSection() {
  const rows = TRAINER_WEIGHT_ROWS;  const body = rows.map((r) => `<tr>${cell(esc(r[0]))}${cell(esc(r[1]))}${cell(esc(r[2]))}</tr>`).join('');
  return `<h3 style="color:#3F4A8A">3. Weights behind the suggested score</h3>`
    + `<p>Suggested score = the sum of the points below for each trainer, counted from the end of their first (training) month. Level: High concern = −9 or below, Watch = −9 to −4, OK = above −4. New joiners are not expected to be highly utilised, so utilization is judged by tenure (tenure is shown in the prediction table).</p>`
    + table(['Signal', 'Dashboard weight', 'Suggested weight used here'], [body]);
}

// The weights behind the Sales suggested score, for the end of the email: dashboard weight vs the weight used here.
function salesWeightsSection() {
  const rows = [
    ['Weekly response quality (AI rating of each weekly check-in, last 90 days)', '+2 to −2 per response', '★5 +2, ★4 +1, ★3 0, ★2 −1, ★1 −2 (same)'],
    ['Weekly progress email not received', '−2 each', '−2 each, max −6'],
    ['Manager feedback below average (latest rated feedback)', '−5', '−5 (same)'],
    ['Negative enquiry audit', '−5 each', '−5 each, max −10'],
    ['Negative HR incidents (last 90 days)', 'not scored', '−2 each, max −4'],
    ['SCs per 30 days', 'not scored', 'Under 2 = −6; under 4 = −3 (only past 6 months from joining); otherwise 0'],
    ['True NR, average of this month + the 2 before', 'not scored', 'Past 6 months: below ₹0 = −6, below ₹5 L = −3. First 6 months: below ₹0 = −6, below ₹3 L = −3. Otherwise 0'],
    ['Positive signals: HR incidents (positive) +3, Ideas for improvement +1, Applied for KGT +1, F2F attended +1, F2F presenter +0.5', 'as listed', 'same'],
    ['Low RMS activity; no emails sent', '0 to −2 each', 'same'],
    ['Tech calls, tech calls under 1 a week, external meetings under 1 a week', '+1 / −0.5 / −5', '0 (on hold)'],
  ];
  const body = rows.map((r) => `<tr>${cell(esc(r[0]))}${cell(esc(r[1]))}${cell(esc(r[2]))}</tr>`).join('');
  return `<h3 style="color:#3F4A8A">3. Weights behind the suggested score</h3>`
    + `<p>Suggested score = the sum of the points below, counted from the end of each person's first (training) month, over the last 90 days unless stated. Level: High concern = −9 or below, Watch = −9 to −6, OK = above −6.</p>`
    + table(['Signal', 'Dashboard weight', 'Suggested weight used here'], [body])
    + `<p>Two overrides: (1) True NR booked for the next 2 months of ₹2 L or more (from the Koenig API) = "On track": the True NR and SC points are dropped and the level is at most Watch. (2) Reached 75% of the quarter target at any point of the running quarter and 75% or more in the last quarter: the SC and True NR points are set aside and the level is at most Watch.</p>`;
}

export function buildSalesEmail(data, { greeting = 'Hi team,' } = {}) {
  const now = data.now;
  const s = data.Sales;
  const d30 = shortDate(s.T30); const fd = forecastDay(now);
  const concern = s.notOn.filter((p) => p.level === 'High concern' || p.level === 'Watch');
  const onPa = s.fired.filter((p) => p.onStatus);
  const subject = `Sales — PA Algo today and 30-day Worry Index prediction (${longDate(now)})`;
  const html = `<div style="font-family:Segoe UI,Arial;font-size:13px"><p>${esc(greeting)}</p>`
    + `<p>Sales report as of ${longDate(now)}. The full version with every column is attached.</p>`
    + `<h3 style="color:#3F4A8A">1. PA Algo firing today — ${s.fired.length} salespeople (${onPa.length} on a running PA/PIP)</h3>${legend('Sales')}`
    + table(['Employee', 'Manager', 'Tenure band', 'What fired (with data)', 'SCs last 30 days', 'Last SC raised', 'True NR last 3 months ₹L', `True NR booked ${upMonths(now)} ₹L`, 'Level (suggested) — reason if High concern / Watch'], salesPart1Rows(data))
    + `<h3 style="color:#3F4A8A">2. Prediction — salespeople not on a running PA/PIP</h3>`
    + `<p>The prediction column is today's suggested score read forward 30 days (to ${fd}). Suggested Worry Index; High concern = −9 or below, Watch = −6 to −9. In the back-test the suggested score flagged 63% of real Sales PA/PIP cases 30 days before they started, and 21% of salespeople who never got one. Anyone with ₹2 L or more of True NR booked for ${upMonths(now)} (from the Koenig API) is at most "Watch". Below: High concern and Watch only (${concern.length}) — the full list is in the attachment. Early-warning list for a manager check-in, not a recommendation to issue a PA/PIP.</p>`
    + table(['Employee', 'Manager', 'Suggested WI today', `Prediction for ${fd} (30 days ahead)`, 'SCs per 30 days', 'True NR 3-mo avg ₹L', `True NR booked ${upMonths(now)} ₹L`, 'NR outlook', 'Main reasons today'], salesPart2Rows(concern, data).map((r) => r.replace(/<td[^>]*>(Yes|No)<\/td><\/tr>$/, '</tr>')))
    + salesWeightsSection()
    + `<p style="color:#666;font-size:11px">True NR = NR net of salary and marketing cost. Generated from the EI dashboard data. Excluded from the lists: ASMs, salespeople on maternity leave and inactive employees.</p></div>`;
  return { subject, html };
}

// ---------- rendering: the Excel attachment (one tab, same layout as before) ----------
function fillCell(cellRef, hex) { cellRef.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex } }; }

async function workbook(title, intro, part1Title, part1Heads, part1Rows, part1Note, part2Heads, part2Rows, part2Intro, weights) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PA Algo and Prediction');
  const head = (row) => { row.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; fillCell(c, '3F4A8A'); c.alignment = { wrapText: true, vertical: 'top' }; }); };
  ws.addRow([title]).font = { bold: true, size: 14 };
  ws.addRow([intro]);
  ws.addRow([]);
  ws.addRow([part1Title]).font = { bold: true, size: 12 };
  head(ws.addRow(part1Heads));
  for (const r of part1Rows) {
    const row = ws.addRow(r.values);
    row.eachCell({ includeEmpty: true }, (c) => { c.alignment = { wrapText: true, vertical: 'top' }; if (r.rowFill) fillCell(c, r.rowFill); });
    if (r.levelCol) { const c = row.getCell(r.levelCol); if (LEVEL_FILL[r.level]) fillCell(c, LEVEL_FILL[r.level]); }
  }
  ws.addRow([part1Note]);
  ws.addRow([]);
  ws.addRow([part2Intro.title]).font = { bold: true, size: 12 };
  ws.addRow([part2Intro.text]);
  head(ws.addRow(part2Heads));
  for (const r of part2Rows) {
    const row = ws.addRow(r.values);
    row.eachCell({ includeEmpty: true }, (c) => { c.alignment = { wrapText: true, vertical: 'top' }; });
    if (LEVEL_FILL[r.level]) fillCell(row.getCell(r.levelCol), LEVEL_FILL[r.level]);
  }
  if (weights) {
    ws.addRow([]);
    ws.addRow(['3. Weights — current (dashboard) vs suggested (used in this report)']).font = { bold: true, size: 12 };
    ws.addRow([weights.note]);
    head(ws.addRow(['Signal', '', 'Current weight (dashboard)', '', 'Suggested weight (used here)']));
    for (const r of weights.rows) {
      const row = ws.addRow([r[0], '', r[1], '', r[2]]);
      row.eachCell({ includeEmpty: true }, (c) => { c.alignment = { wrapText: true, vertical: 'top' }; });
      ws.mergeCells(row.number, 1, row.number, 2); ws.mergeCells(row.number, 3, row.number, 4); ws.mergeCells(row.number, 5, row.number, 8);
    }
  }
  const widths = Math.max(part1Heads.length, part2Heads.length);
  ws.columns.forEach((col, i) => { col.width = [24, 10, 22, 18, 16, 60, 12, 12, 12, 14, 14, 40][i] || 16; });
  for (let i = ws.columns.length; i < widths; i++) ws.getColumn(i + 1).width = 16;
  ws.getRow(1).alignment = { wrapText: false };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildTrainerWorkbook(data) {
  const now = data.now; const t = data.Trainer; const { m3, cur } = trainerMonths(now);
  const d30 = shortDate(t.T30); const fd = forecastDay(now);
  const p1 = t.fired.map((p) => {
    const e = p.e;
    const showReason = p.level === 'High concern' || p.level === 'Watch';
    const levelText = showReason ? `${p.level} — ${reasonText(p.sc)}` : p.level;
    return { values: [e.name, e.id, e.manager || '—', TIER[p.algo.tier] || p.algo.tier || '', p.algo.band, evidenceText(e, p.algo), ...m3.map((m) => utilByMonth(e, m.idx)), utilByMonth(e, cur.idx), p.sc.noScore ? '' : p.sc.wi, levelText], rowFill: p.onStatus ? STATUS_FILL[p.onStatus] : null, level: p.level, levelCol: 12 };
  });
  const firedIds = new Set(t.fired.map((p) => p.e.id));
  const p2 = t.notOn.map((p) => ({ values: [p.e.name, p.e.id, p.e.manager || '—', tenureText(p.e, now), p.sc.noScore ? '' : p.sc.wi, forecastLabel(p), p.sc.extras?.util3 ?? '', reasonText(p.sc) || '—', firedIds.has(p.e.id) ? 'Yes' : 'No'], level: p.level, levelCol: 6 }));
  return workbook(
    `Trainers — PA Algo today and 30-day Worry Index prediction (as of ${longDate(now)})`,
    `Part 1: every active trainer the PA Algo fires for today (same rules as the dashboard's Trainer PA Algo screen; Assistant Technical Managers, maternity cases and resigned employees excluded), with the data behind it. Rows are highlighted yellow (PA) or orange (PIP) when a PA/PIP is running today. Part 2: trainers NOT on a running PA/PIP, scored with the suggested Trainer Worry Index weights today and 30 days before (${d30}).`,
    '1. PA Algo firing today (no PA/PIP listed first; running PA = yellow, running PIP = orange)',
    ['Employee', 'Emp ID', 'Manager', 'Salary tier', 'Tenure band', 'What fired (with data)', `Util ${m3[0].name} %`, `Util ${m3[1].name} %`, `Util ${m3[2].name} %`, `Util ${cur.name} % (booked so far)`, 'Suggested WI today', 'Level (suggested) — reason if High concern / Watch'],
    p1,
    'Utilization = SC + Non-SC hours as on the dashboard. Highlighted = PA/PIP running today. Current-month utilization counts hours already scheduled.',
    ['Employee', 'Emp ID', 'Manager', 'Tenure', 'Suggested WI today', `Prediction for ${fd} (30 days ahead)`, 'Utilization, last 3 completed months %', 'Main reasons today', 'Also on PA Algo today?'],
    p2,
    { title: `2. Prediction — trainers not on a running PA/PIP, suggested Worry Index`, text: 'Levels: High concern = −9 or below, Watch = −4 to −9, OK = above −4. Suggested Trainer weights: utilization over the last 3 completed months — 6 months and over: below 30% −6, 30–40% −3; 2–6 months: below 15% −6, 15–25% −3; first 2 months: not penalised; tech calls converted and polls 0; course marking capped at +5; negative delivery feedback −2 each; manager feedback below average −2; the rest as on the dashboard. Back-test (Mar–Oct 2026, a score every 14 days, PA/PIP within the next 30 days): the suggested score had 35% of the cases that got a PA/PIP on High concern or Watch, against 15% of those that did not. Early-warning list for a manager check-in — not a recommendation to issue a PA or PIP.' },
    { note: 'Suggested score = the sum of these points per trainer, counted from the end of the training month. Levels: High concern = −9 or below, Watch = −9 to −4, OK = above −4. Utilization is judged by tenure.', rows: TRAINER_WEIGHT_ROWS }
  );
}

export async function buildSalesWorkbook(data) {
  const now = data.now; const s = data.Sales;
  const d30 = shortDate(s.T30); const fd = forecastDay(now);
  const mUp = upMonths(now);
  const p1 = s.fired.map((p) => {
    const e = p.e; const m = salesFacts(e, now);
    const showReason = p.level === 'High concern' || p.level === 'Watch';
    const levelText = showReason ? `${p.level} — ${reasonText(p.sc)}` : p.level;
    return { values: [e.name, e.id, e.manager || '—', (p.algo.region || '').replace(/^./, (c) => c.toUpperCase()), p.algo.band, evidenceText(e, p.algo), m.sc30, m.lastSc, m.tnr3, m.booked, p.sc.noScore ? '' : p.sc.wi, levelText], rowFill: p.onStatus ? STATUS_FILL[p.onStatus] : null, level: p.level, levelCol: 12 };
  });
  const firedIds = new Set(s.fired.map((p) => p.e.id));
  const p2 = s.notOn.map((p) => { const x = p.sc.extras || {}; return { values: [p.e.name, p.e.id, p.e.manager || '—', p.sc.noScore ? '' : p.sc.wi, forecastLabel(p), x.sc30 ?? '', x.tnrAvgL ?? '', x.bookedL ?? '', [x.outlook, x.targetNote].filter(Boolean).join(' · '), reasonText(p.sc) || '—', firedIds.has(p.e.id) ? 'Yes' : 'No'], level: p.level, levelCol: 5 }; });
  return workbook(
    `Sales — PA Algo today and 30-day Worry Index prediction (as of ${longDate(now)})`,
    `Part 1: every active salesperson the PA Algo fires for today (same list as the dashboard's Sales PA Algo screen: ASMs and maternity cases excluded), with the data behind it. Rows are highlighted yellow (PA) or orange (PIP) when a PA/PIP is running today. Part 2: salespeople NOT on a running PA/PIP, scored with the suggested Worry Index weights today and 30 days before (${d30}). Quarter targets are not used.`,
    '1. PA Algo firing today (no PA/PIP listed first; running PA = yellow, running PIP = orange)',
    ['Employee', 'Emp ID', 'Manager', 'Region', 'Tenure band', 'What fired (with data)', 'SCs last 30 days', 'Last SC raised', 'True NR last 3 months ₹L', `True NR booked ${mUp} ₹L`, 'Suggested WI today', 'Level (suggested) — reason if High concern / Watch'],
    p1,
    `True NR = NR net of salary and marketing cost. True NR booked = Koenig's True NR for ${mUp}, straight from the API. Highlighted = PA/PIP running today.`,
    ['Employee', 'Emp ID', 'Manager', 'Suggested WI today', `Prediction for ${fd} (30 days ahead)`, 'SCs per 30 days', 'True NR 3-mo avg ₹L', `True NR booked ${mUp} ₹L`, 'NR outlook', 'Main reasons today', 'Also on PA Algo today?'],
    p2,
    { title: `2. Prediction — salespeople not on a running PA/PIP, suggested Worry Index`, text: `Levels: High concern = −9 or below, Watch = −6 to −9, OK = above −6. In the back-test the suggested score flagged 63% of real Sales PA/PIP cases 30 days before they started, and 21% of salespeople who never got one. Anyone with ₹2 L or more of True NR booked for ${mUp} (from the Koenig API) is at most "Watch". This is an early-warning list for a manager check-in — not a recommendation to issue a PA or PIP.` },
  );
}

// ---------- assemble + send ----------
export async function buildReports({ now = new Date(), greeting, excludeIds } = {}) {
  const data = await buildReportData({ now, excludeIds });
  const [tw, sw] = await Promise.all([buildTrainerWorkbook(data), buildSalesWorkbook(data)]);
  const stamp = istDateString(now);
  const mk = (email, wbBuf, name) => ({ ...email, attachments: [{ name, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: wbBuf.toString('base64') }] });
  return {
    data,
    trainer: mk(buildTrainerEmail(data, { greeting }), tw, `Trainer_PA_Algo_and_Prediction_${stamp}.xlsx`),
    sales: mk(buildSalesEmail(data, { greeting }), sw, `Sales_PA_Algo_and_Prediction_${stamp}.xlsx`),
  };
}

export const REPORT_TO = ['HR@koenig-solutions.com'];

export async function sendPredictionReports({ to = REPORT_TO, cc, prefix = '', greeting, now } = {}) {
  const { sendMail } = await import('./graphMailer.js');
  const rep = await buildReports({ now, greeting });
  for (const r of [rep.trainer, rep.sales]) await sendMail({ to, cc, subject: prefix + r.subject, html: r.html, attachments: r.attachments });
  const c = (t) => `${rep.data[t].fired.length} fired, ${rep.data[t].notOn.filter((p) => p.level === 'High concern' || p.level === 'Watch').length} High concern/Watch`;
  return { message: `Sent Trainer (${c('Trainer')}) and Sales (${c('Sales')}) prediction reports to ${[].concat(to).join(', ')}.` };
}

// Wednesday cron entry point (feed "predictionreports").
export async function sendWeeklyPredictionReports() {
  return sendPredictionReports({});
}
export { asOf, levelFor };
