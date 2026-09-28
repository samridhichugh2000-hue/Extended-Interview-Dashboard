// Trainer PA Algo — flags Trainers whose delivery numbers (assignments/
// utilization) fall below the bar expected for their salary tier and
// tenure. This is a *proposed* flag, separate from the real PA/PIP records
// synced from Koenig (pip_status/employees.status) — it does not write
// anything, just tells the caller whether this employee's current numbers
// would justify raising one.
//
// Salary tier is read from net_payable_details.PayScale (the fixed monthly
// pay scale), not .Salary (net amount actually paid that month, which
// shrinks with leave/absences and would misclassify anyone who took time
// off) — and from the *current* synced payroll snapshot as a stand-in for
// salary at DOJ (no joining-month payroll snapshot is kept).
//
// Tenure-band boundaries below use 30-day months / 365-day years, applied
// to tenure_days directly (matching NJ_TENURE_DAYS' own day-based
// convention elsewhere in lib/data.js) — the source spec names bands in
// months/years, not exact day counts.

const MONTH_DAYS = 30;
const YEAR_DAYS = 365;

export const TRAINER_SALARY_TIERS = {
  UNDER_125K: 'under125k',
  BETWEEN_125K_200K: 'between125kAnd200k',
  OVER_200K: 'over200k', // "K11" in the source spec
};

export function trainerSalaryTier(payScale) {
  if (payScale == null) return null;
  if (payScale < 125000) return TRAINER_SALARY_TIERS.UNDER_125K;
  if (payScale <= 200000) return TRAINER_SALARY_TIERS.BETWEEN_125K_200K;
  return TRAINER_SALARY_TIERS.OVER_200K;
}

// Average utilization over the trailing `days` (approximated as `days / 30`
// trailing calendar months, inclusive of the most recent synced month),
// skipping months with no data. Returns null if none of those months has
// any data at all (e.g. NJ who hasn't had a full window yet).
export function trailingUtilization(utilMonthlyDetails, days) {
  if (!utilMonthlyDetails?.length) return null;
  const monthCount = Math.round(days / MONTH_DAYS);
  const window = utilMonthlyDetails.slice(-monthCount);
  const values = window.map((m) => m.util).filter((v) => v != null);
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// True if this employee has at least one Main Trainer assignment (from the
// Trainer RC Schedule feed — koenigTrainerRcApi.js/rcMainAssignmentsDetails,
// synced by syncTrainerRc) that did NOT generate negative feedback
// ("excluding -ve feedback assignment" per the source spec).
export function hasCleanAssignment(rcMainAssignmentsDetails, negFeedbackDetails) {
  if (!rcMainAssignmentsDetails?.length) return false;
  const negAssignmentIds = new Set((negFeedbackDetails || []).map((f) => f.assignmentId));
  return rcMainAssignmentsDetails.some((a) => !negAssignmentIds.has(a.assignmentId));
}

// Each band's `check` returns { status, evidence } — status is
// 'fired' | 'clear' | 'no-data' (a missing utilization window is NOT the
// same as "clear", so it gets its own status rather than silently reading
// as a pass); evidence is the exact data behind that status, e.g. the
// trailing months' utilization figures or the assignment list, so the
// dashboard can show the full backing data for a fired row without the
// user having to go dig it up in another screen.
function utilCheck(days, threshold) {
  const monthCount = Math.round(days / MONTH_DAYS);
  return (e) => {
    const window = (e.utilMonthlyDetails || []).slice(-monthCount);
    const u = trailingUtilization(e.utilMonthlyDetails, days);
    const evidence = {
      label: `Utilization — trailing ${days} days`,
      columns: ['Month', 'Utilization'],
      rows: window.map((m) => [m.month, m.util != null ? `${m.util}%` : '—']),
      summary: u != null ? `Average ${u.toFixed(1)}% (threshold ${threshold}%)` : 'No utilization data synced yet',
    };
    return { status: u == null ? 'no-data' : u < threshold ? 'fired' : 'clear', evidence };
  };
}
// rcMainAssignmentsCount is null until syncTrainerRc has run for this
// employee — distinct from a confirmed 0 (genuinely zero Main Trainer
// assignments in the lookback window), which really does fire.
const assignmentCheck = (e) => {
  const evidence = {
    label: 'Main Trainer assignments (excluding negative-feedback ones)',
    columns: ['Assignment', 'Course', 'Start date'],
    rows: (e.rcMainAssignmentsDetails || []).map((a) => [a.assignmentId, a.courseName, a.startDate]),
    summary: e.rcMainAssignmentsCount == null ? 'No RC schedule data synced yet' : `${e.rcMainAssignmentsCount} Main Trainer assignment(s) on file`,
  };
  if (e.rcMainAssignmentsCount == null) return { status: 'no-data', evidence };
  return { status: hasCleanAssignment(e.rcMainAssignmentsDetails, e.negFeedbackDetails) ? 'clear' : 'fired', evidence };
};

// Tenure bands, oldest first, per salary tier.
const UNDER_125K_BANDS = [
  { minDays: 0, label: '0-3 months', rule: 'Zero assignments as main trainer (excluding -ve feedback assignment)', check: assignmentCheck },
  { minDays: 3 * MONTH_DAYS, label: '3-6 months', rule: '< 15% utilization in last 180 days', check: utilCheck(180, 15) },
  { minDays: 6 * MONTH_DAYS, label: '6-12 months', rule: '< 25% utilization in last 180 days', check: utilCheck(180, 25) },
  { minDays: YEAR_DAYS, label: '1-2 years', rule: '< 40% utilization in last 360 days', check: utilCheck(360, 40) },
  { minDays: 2 * YEAR_DAYS, label: '2 years plus', rule: '< 50% utilization in last 270 days', check: utilCheck(270, 50) },
];

const BETWEEN_125K_200K_BANDS = [
  { minDays: 0, label: 'within 45 days', rule: 'Zero assignments as main trainer (excluding -ve feedback assignment)', check: assignmentCheck },
  { minDays: 45, label: '45 days-3 months', rule: '< 15% utilization in last 180 days', check: utilCheck(180, 15) },
  { minDays: 3 * MONTH_DAYS, label: '3-5 months', rule: '< 25% utilization in last 180 days', check: utilCheck(180, 25) },
  { minDays: 5 * MONTH_DAYS, label: '5-7 months', rule: '< 40% utilization in last 360 days', check: utilCheck(360, 40) },
  // 8-11 months and 12+ months share the same threshold in the source spec,
  // so they're merged into one "7 months onward" band.
  { minDays: 7 * MONTH_DAYS, label: '8 months onwards', rule: '< 50% utilization in last 270 days', check: utilCheck(270, 50) },
];

// K11 / >2 lacs — flat rule, no tenure banding.
const OVER_200K_BANDS = [
  { minDays: 0, label: 'any tenure (K11)', rule: '< 50% utilization in last 270 days', check: utilCheck(270, 50) },
];

const BANDS_BY_TIER = {
  [TRAINER_SALARY_TIERS.UNDER_125K]: UNDER_125K_BANDS,
  [TRAINER_SALARY_TIERS.BETWEEN_125K_200K]: BETWEEN_125K_200K_BANDS,
  [TRAINER_SALARY_TIERS.OVER_200K]: OVER_200K_BANDS,
};

// feedbackDate comes back as "26-Feb-2025 17:06 PM" — the HH:MM is already
// 24-hour, so the trailing AM/PM is redundant/malformed and V8's Date
// parser rejects the full string. Only day-level granularity matters for a
// 7-day window, so just the date prefix is parsed.
function parseFeedbackDate(raw) {
  if (!raw) return null;
  const d = new Date(String(raw).split(' ')[0]);
  return isNaN(d.getTime()) ? null : d;
}

// Human-readable date for evidence tables — handles both ISO datetimes (SC
// createdOn, e.g. "2026-08-24T10:33:52.983") and Koenig's malformed
// "DD-Mon-YYYY HH:MM AM/PM" strings (feedbackDate, see parseFeedbackDate
// above) by only ever parsing the date portion, splitting on whichever of
// 'T'/space appears first.
function formatDate(raw) {
  if (!raw) return '—';
  const d = new Date(String(raw).split(/[T ]/)[0]);
  return isNaN(d.getTime()) ? String(raw) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// By explicit instruction, "1st/2nd/3rd negative" resets on a trailing
// 7-day window (a trainer "receiving" a negative counts only if it landed
// this week) — this rarely reaches PIP/Exit in practice, confirmed intended
// despite that.
const NEG_FEEDBACK_WINDOW_DAYS = 7;

// neg_feedback_details has one row per (assignment × CSM × question) the
// Koenig feed returned, not one row per negative assignment — the same
// assignment can show up dozens of times (one real case had 606 raw rows
// across just 10 actual assignments). "1st/2nd/3rd negative" means distinct
// assignments within the window, so this counts unique assignmentIds whose
// feedbackDate falls in the trailing NEG_FEEDBACK_WINDOW_DAYS, rather than
// trusting neg_feedback_details.length (or the equally-inflated neg_feedback
// field) over all time.
export function distinctNegativeFeedbackAssignments(negFeedbackDetails, now = new Date()) {
  return distinctRecentNegativeFeedbackEntries(negFeedbackDetails, now).length;
}

// The actual distinct assignments behind distinctNegativeFeedbackAssignments'
// count — one entry per assignmentId (first occurrence within the window
// kept), so the dashboard can show exactly which assignment(s) and when,
// not just a number.
export function distinctRecentNegativeFeedbackEntries(negFeedbackDetails, now = new Date()) {
  const cutoff = now.getTime() - NEG_FEEDBACK_WINDOW_DAYS * 86400000;
  const seen = new Map();
  for (const f of negFeedbackDetails || []) {
    const d = parseFeedbackDate(f.feedbackDate);
    if (d && d.getTime() >= cutoff && !seen.has(f.assignmentId)) {
      seen.set(f.assignmentId, { assignmentId: f.assignmentId, feedbackDate: f.feedbackDate, clientName: f.clientName });
    }
  }
  return [...seen.values()];
}

// Negative-feedback escalation ladder — independent of salary tier/tenure
// band above: 1st negative-feedback assignment this week suggests PA, 2nd
// suggests PIP, 3rd+ suggests exit.
export function negativeFeedbackSuggestion(distinctAssignmentCount) {
  if (!distinctAssignmentCount) return null;
  if (distinctAssignmentCount === 1) return 'PA';
  if (distinctAssignmentCount === 2) return 'PIP';
  return 'Exit';
}

// Human-readable reason for a negFeedbackSuggestion firing, e.g. "2 distinct
// negative-feedback assignments in the last 7 days → Suggested PIP" — shown
// in the dashboard's Rule column (appended to the band's own rule, if any)
// so a row that fired via the negative-feedback override doesn't just show
// the tier/band's rule text, which may not be why it actually fired (e.g.
// utilization was fine, but a fresh negative-feedback assignment came in).
function negFeedbackReason(distinctAssignmentCount, suggestion) {
  if (!suggestion) return null;
  return `${distinctAssignmentCount} distinct negative-feedback assignment${distinctAssignmentCount === 1 ? '' : 's'} in the last 7 days → Suggested ${suggestion}`;
}

// Returns (negFeedbackSuggestion is computed independently of the tier/band
// check below, but a truthy one *overrides* status to 'fired' — a fresh
// negative-feedback assignment is itself a firing condition, not just an
// informational side badge, so a trainer with one never reads as "Clear"
// (or "No data"/"No salary data") just because their utilization or
// assignment numbers happen to look fine. `rule` gets negFeedbackReason
// appended whenever it fires, so the Rule column always explains why.
// `evidence` is an array of { label, columns, rows, summary } blocks — the
// full backing data for every condition that actually contributed to the
// status, so the dashboard can show it inline without another screen):
//   { status: 'no-salary-data', negFeedbackSuggestion, rule?, evidence }  — net_payable_details not synced for this employee yet (rule/evidence only set if negFeedbackSuggestion fired)
//   { status: 'no-data', tier, band, rule, negFeedbackSuggestion, evidence }  — matched a band, but it needs data (assignments/utilization) we don't have
//   { status: 'clear', tier, band, rule, negFeedbackSuggestion, evidence }    — matched a band, condition did not fire, and no negative-feedback override
//   { status: 'fired', tier, band, rule, negFeedbackSuggestion, evidence }    — matched a band, condition fired, OR negFeedbackSuggestion overrode it — PA Algo candidate
export function computeTrainerPaAlgoFlag(employee) {
  const negFeedbackEntries = distinctRecentNegativeFeedbackEntries(employee.negFeedbackDetails);
  const negFeedbackSuggestion = negativeFeedbackSuggestion(negFeedbackEntries.length);
  const negFeedbackFires = negFeedbackSuggestion != null;
  const negReason = negFeedbackReason(negFeedbackEntries.length, negFeedbackSuggestion);
  const negFeedbackEvidence = negFeedbackFires ? {
    label: `Negative-feedback assignments — trailing ${NEG_FEEDBACK_WINDOW_DAYS} days`,
    columns: ['Assignment', 'Feedback date', 'Client'],
    rows: negFeedbackEntries.map((f) => [f.assignmentId, formatDate(f.feedbackDate), f.clientName || '—']),
    summary: `${negFeedbackEntries.length} distinct assignment(s) → Suggested ${negFeedbackSuggestion}`,
  } : null;

  const payScale = employee.netPayableDetails?.PayScale != null ? Number(employee.netPayableDetails.PayScale) : null;
  const tier = trainerSalaryTier(payScale);
  if (tier == null) {
    return {
      status: negFeedbackFires ? 'fired' : 'no-salary-data',
      negFeedbackSuggestion,
      rule: negReason,
      evidence: [negFeedbackEvidence].filter(Boolean),
    };
  }

  const bands = BANDS_BY_TIER[tier];
  const tenureDays = employee.tenure ?? 0;
  // Last band whose minDays the employee has reached — bands are ordered
  // ascending, so this is the most specific match.
  const band = [...bands].reverse().find((b) => tenureDays >= b.minDays);
  const { status: bandStatus, evidence: bandEvidence } = band.check(employee);

  const rule = negFeedbackFires ? (band.rule ? `${band.rule}; ${negReason}` : negReason) : band.rule;
  return {
    status: negFeedbackFires ? 'fired' : bandStatus,
    tier,
    band: band.label,
    rule,
    negFeedbackSuggestion,
    evidence: [bandEvidence, negFeedbackEvidence].filter(Boolean),
  };
}

// --- Sales PA Algo -----------------------------------------------------
// Flags Sales reps (CCEs) whose Net Revenue (NR) falls below the bar
// expected for their tenure, per HR's spec — split by India-based vs
// Overseas-based (employees.country, from syncEmployeeDetails — NOT
// is_overseas, which Koenig's own feed sets inconsistently; see the region
// derivation below), since the two use entirely different measures: India compares average monthly
// NR as a *multiple* of monthly salary; Overseas compares average monthly
// NR against a flat INR-per-month bar. Same "proposed flag, doesn't write
// anything" contract as the Trainer version above — this never touches
// pip_status.

export const SALES_REGIONS = {
  INDIA: 'india',
  OVERSEAS: 'overseas',
};

// nrMonthlyDetails is chronological oldest-first (see syncPms's fullHistory
// in lib/syncRunners.js) — Koenig only ever returns months from DOJ onward,
// so "every month on file" already means "every month since joining", with
// no separate since-DOJ filtering needed.
function totalNR(nrMonthlyDetails) {
  if (!nrMonthlyDetails?.length) return null;
  return nrMonthlyDetails.reduce((sum, m) => sum + (m.nr ?? 0), 0);
}

// True average over the trailing `months` calendar months on file (fewer,
// for a rep with under `months` months of tenure — or, with `months` left
// null/undefined, every month on file, used by the 6-11 month band since a
// rep that young can never have a full 12-month window to average over
// anyway). NOT filtered to skip zero-revenue months the way Trainer's
// trailingUtilization skips "no data" months above: a real ₹0 month here is
// a real data point that should pull the average down, not get treated as
// missing data.
function avgNR(nrMonthlyDetails, months) {
  if (!nrMonthlyDetails?.length) return null;
  const window = months ? nrMonthlyDetails.slice(-months) : nrMonthlyDetails;
  if (!window.length) return null;
  return window.reduce((sum, m) => sum + (m.nr ?? 0), 0) / window.length;
}

const INR = (n) => '₹' + n.toLocaleString('en-IN');

// Each check receives { total, nrMonthlyDetails, payScale } (total NR since
// joining, the raw monthly history for avgNR to window, and payScale from
// net_payable_details.PayScale) and returns { status, evidence } —
// status is 'fired' | 'clear' | 'no-data'; evidence is the month-by-month
// NR behind that number, so a fired row can show exactly which months and
// figures drove it. `months` (undefined = every month on file) picks the
// averaging window — see avgNR above.
function roiCheck(threshold) {
  return ({ total, nrMonthlyDetails }) => {
    const evidence = {
      label: 'NR since joining (ROI)',
      columns: ['Month', 'NR'],
      rows: (nrMonthlyDetails || []).map((m) => [m.month, INR(m.nr)]),
      summary: total != null ? `Total: ${INR(total)} (threshold ${INR(threshold)})` : 'No NR data synced yet',
    };
    return { status: total == null ? 'no-data' : total < threshold ? 'fired' : 'clear', evidence };
  };
}
function salaryMultipleCheck(multiple, months) {
  return ({ nrMonthlyDetails, payScale }) => {
    const window = months ? (nrMonthlyDetails || []).slice(-months) : (nrMonthlyDetails || []);
    const avg = avgNR(nrMonthlyDetails, months);
    const evidence = {
      label: `NR — ${months ? `trailing ${months} months` : 'all months since joining'}`,
      columns: ['Month', 'NR'],
      rows: window.map((m) => [m.month, INR(m.nr)]),
      summary: avg != null && payScale != null
        ? `Average ${INR(Math.round(avg))}/mo ÷ salary ${INR(payScale)} = ${(avg / payScale).toFixed(2)}x (threshold ${multiple}x)`
        : 'Missing NR or salary data',
    };
    if (avg == null || payScale == null) return { status: 'no-data', evidence };
    return { status: avg / payScale < multiple ? 'fired' : 'clear', evidence };
  };
}
function avgThresholdCheck(threshold, months) {
  return ({ nrMonthlyDetails }) => {
    const window = months ? (nrMonthlyDetails || []).slice(-months) : (nrMonthlyDetails || []);
    const avg = avgNR(nrMonthlyDetails, months);
    const evidence = {
      label: `NR — ${months ? `trailing ${months} months` : 'all months since joining'}`,
      columns: ['Month', 'NR'],
      rows: window.map((m) => [m.month, INR(m.nr)]),
      summary: avg != null ? `Average ${INR(Math.round(avg))}/mo (threshold ${INR(threshold)}/mo)` : 'No NR data synced yet',
    };
    return { status: avg == null ? 'no-data' : avg < threshold ? 'fired' : 'clear', evidence };
  };
}

// --- Independent overriding conditions (ii)/(iii) — apply regardless of
// region/band, same pattern as Trainer's negative-feedback ladder. Each
// returns null if not applicable/not fired, or { reason, evidence } if it
// fires.

// (ii) Zero SC (Service Contract) raised in the trailing 30 days. Needs a
// full 30-day window to mean anything — exempts anyone under 30 days
// tenure, who would otherwise trivially fire this on day one.
const ZERO_SC_MIN_TENURE_DAYS = 30;
const ZERO_SC_WINDOW_DAYS = 30;
function zeroScCheck(employee) {
  const tenureDays = employee.tenure ?? 0;
  if (tenureDays < ZERO_SC_MIN_TENURE_DAYS) return null;
  const scDetails = employee.scDetails || [];
  const cutoff = Date.now() - ZERO_SC_WINDOW_DAYS * 86400000;
  const recentCount = scDetails.filter((s) => {
    const d = new Date(s.createdOn);
    return !isNaN(d.getTime()) && d.getTime() >= cutoff;
  }).length;
  if (recentCount > 0) return null;

  const lastFew = [...scDetails].sort((a, b) => new Date(b.createdOn) - new Date(a.createdOn)).slice(0, 5);
  return {
    reason: `Zero SCs raised in the trailing ${ZERO_SC_WINDOW_DAYS} days`,
    evidence: {
      label: `Most recent SCs on file (0 in trailing ${ZERO_SC_WINDOW_DAYS} days)`,
      columns: ['SC ID', 'Created on', 'Status'],
      rows: lastFew.map((s) => [s.scId, formatDate(s.createdOn), s.status || '—']),
      summary: lastFew.length ? `Most recent SC: ${formatDate(lastFew[0].createdOn)}` : 'No SCs on file at all',
    },
  };
}

// (iii) Negative total NR over the trailing 3 months, for anyone past 6
// months tenure (the 3-6 month band already has its own since-joining ROI
// check above — this catches a bad recent quarter for longer-tenured reps
// whose long-run average/multiple still looks clear).
const NEG_ROI_3MO_MIN_TENURE_DAYS = 6 * MONTH_DAYS;
function recentNegRoiCheck(employee) {
  const tenureDays = employee.tenure ?? 0;
  if (tenureDays <= NEG_ROI_3MO_MIN_TENURE_DAYS) return null;
  const window = (employee.nrMonthlyDetails || []).slice(-3);
  if (!window.length) return null;
  const total = window.reduce((sum, m) => sum + (m.nr ?? 0), 0);
  if (total >= 0) return null;

  return {
    reason: `-ve total NR over trailing 3 months (${INR(total)})`,
    evidence: {
      label: 'NR — trailing 3 months',
      columns: ['Month', 'NR'],
      rows: window.map((m) => [m.month, INR(m.nr)]),
      summary: `Total: ${INR(total)}`,
    },
  };
}

// Tenure bands, oldest first, per HR's spec. 0-3 months has no applicable
// rule at all (the spec's table starts at 3-6 months) — always 'no-data'
// there rather than a silent pass.
const SALES_BANDS = [
  {
    minDays: 0, label: '0-3 months',
    india: { rule: 'No PA Algo criteria for under 3 months tenure', check: () => ({ status: 'no-data', evidence: null }) },
    overseas: { rule: 'No PA Algo criteria for under 3 months tenure', check: () => ({ status: 'no-data', evidence: null }) },
  },
  {
    minDays: 3 * MONTH_DAYS, label: '3-6 months',
    india: { rule: '-ve ROI (total NR since joining)', check: roiCheck(0) },
    overseas: { rule: `ROI (total NR since joining) < -${INR(500000)}`, check: roiCheck(-500000) },
  },
  {
    // No 12-month window is possible yet at this tenure — averages over
    // every month on file (since joining) instead of a trailing-12 slice.
    minDays: 6 * MONTH_DAYS, label: '6-11 months',
    india: { rule: 'Avg NR (all months since joining) / salary < 1.25x', check: salaryMultipleCheck(1.25) },
    overseas: { rule: `Avg NR (all months since joining) < ${INR(100000)}/month`, check: avgThresholdCheck(100000) },
  },
  {
    minDays: YEAR_DAYS, label: '1-2 years',
    india: { rule: 'Avg NR (trailing 12mo) / salary < 2.75x', check: salaryMultipleCheck(2.75, 12) },
    overseas: { rule: `Avg NR (trailing 12mo) < ${INR(500000)}/month`, check: avgThresholdCheck(500000, 12) },
  },
  {
    minDays: 2 * YEAR_DAYS, label: '2-3 years',
    india: { rule: 'Avg NR (trailing 12mo) / salary < 5x', check: salaryMultipleCheck(5, 12) },
    overseas: { rule: `Avg NR (trailing 12mo) < ${INR(1000000)}/month`, check: avgThresholdCheck(1000000, 12) },
  },
  {
    minDays: 3 * YEAR_DAYS, label: '3-4 years',
    india: { rule: 'Avg NR (trailing 12mo) / salary < 7.5x', check: salaryMultipleCheck(7.5, 12) },
    overseas: { rule: `Avg NR (trailing 12mo) < ${INR(1500000)}/month`, check: avgThresholdCheck(1500000, 12) },
  },
  {
    minDays: 4 * YEAR_DAYS, label: '4 years plus',
    india: { rule: 'Avg NR (trailing 12mo) / salary < 9x', check: salaryMultipleCheck(9, 12) },
    overseas: { rule: `Avg NR (trailing 12mo) < ${INR(2000000)}/month`, check: avgThresholdCheck(2000000, 12) },
  },
];

// Returns (zeroSc/recentNegRoi are independent overriding conditions — (ii)
// and (iii) — checked regardless of region/band, same pattern as Trainer's
// negative-feedback ladder: either one firing overrides status to 'fired'
// and gets its reason appended to `rule`. `evidence` is an array of
// { label, columns, rows, summary } blocks, the full backing data for
// every condition that actually contributed):
//   { status: 'no-country-data', rule?, evidence }        — country not synced yet (syncEmployeeDetails), can't tell which column of the base table applies — (ii)/(iii) still checked since they don't need region
//   { status: 'no-data', band, rule, region, evidence }    — matched a band, but it needs NR/salary data we don't have, and no override fired
//   { status: 'clear', band, rule, region, evidence }      — matched a band, condition did not fire, and no override fired
//   { status: 'fired', band, rule, region, evidence }      — matched a band, condition fired, OR (ii)/(iii) overrode it — PA Algo candidate
export function computeSalesPaAlgoFlag(employee) {
  const zeroSc = zeroScCheck(employee);
  const recentNegRoi = recentNegRoiCheck(employee);
  const overrides = [zeroSc, recentNegRoi].filter(Boolean);
  const overrideReason = overrides.map((o) => o.reason).join('; ') || null;
  const overrideEvidence = overrides.map((o) => o.evidence);

  if (employee.country == null) {
    return {
      status: overrides.length ? 'fired' : 'no-country-data',
      rule: overrideReason,
      evidence: overrideEvidence,
    };
  }
  // Region comes from country, not the raw is_overseas flag — Koenig's own
  // Is_oversease flag is unreliable (confirmed live: Egypt/Germany/Nigeria/
  // Oman/Singapore/South Africa/UAE/US/Canada employees all have it set to
  // 0/false despite being clearly non-India), so trusting it misclassified
  // real Overseas reps as India. country itself is consistent.
  const isOverseas = employee.country !== 'India';

  const tenureDays = employee.tenure ?? 0;
  const band = [...SALES_BANDS].reverse().find((b) => tenureDays >= b.minDays);
  const spec = isOverseas ? band.overseas : band.india;

  const total = totalNR(employee.nrMonthlyDetails);
  const payScale = employee.netPayableDetails?.PayScale != null ? Number(employee.netPayableDetails.PayScale) : null;
  const { status: bandStatus, evidence: bandEvidence } = spec.check({ total, nrMonthlyDetails: employee.nrMonthlyDetails, payScale });

  const rule = overrideReason ? (spec.rule ? `${spec.rule}; ${overrideReason}` : overrideReason) : spec.rule;
  return {
    status: overrides.length ? 'fired' : bandStatus,
    band: band.label,
    rule,
    region: isOverseas ? SALES_REGIONS.OVERSEAS : SALES_REGIONS.INDIA,
    evidence: [bandEvidence, ...overrideEvidence].filter(Boolean),
  };
}
