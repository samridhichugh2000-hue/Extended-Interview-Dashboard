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

// Each band's `check` returns 'fired' | 'clear' | 'no-data' — a missing
// utilization window is NOT the same as "clear" (utilization >= threshold),
// so it gets its own status rather than silently reading as a pass.
function utilCheck(days, threshold) {
  return (e) => {
    const u = trailingUtilization(e.utilMonthlyDetails, days);
    if (u == null) return 'no-data';
    return u < threshold ? 'fired' : 'clear';
  };
}
// rcMainAssignmentsCount is null until syncTrainerRc has run for this
// employee — distinct from a confirmed 0 (genuinely zero Main Trainer
// assignments in the lookback window), which really does fire.
const assignmentCheck = (e) => {
  if (e.rcMainAssignmentsCount == null) return 'no-data';
  return hasCleanAssignment(e.rcMainAssignmentsDetails, e.negFeedbackDetails) ? 'clear' : 'fired';
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
  const cutoff = now.getTime() - NEG_FEEDBACK_WINDOW_DAYS * 86400000;
  const ids = new Set();
  for (const f of negFeedbackDetails || []) {
    const d = parseFeedbackDate(f.feedbackDate);
    if (d && d.getTime() >= cutoff) ids.add(f.assignmentId);
  }
  return ids.size;
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
// appended whenever it fires, so the Rule column always explains why):
//   { status: 'no-salary-data', negFeedbackSuggestion, rule? }         — net_payable_details not synced for this employee yet (rule only set if negFeedbackSuggestion fired)
//   { status: 'no-data', tier, band, rule, negFeedbackSuggestion }     — matched a band, but it needs data (assignments/utilization) we don't have
//   { status: 'clear', tier, band, rule, negFeedbackSuggestion }       — matched a band, condition did not fire, and no negative-feedback override
//   { status: 'fired', tier, band, rule, negFeedbackSuggestion }       — matched a band, condition fired, OR negFeedbackSuggestion overrode it — PA Algo candidate
export function computeTrainerPaAlgoFlag(employee) {
  const negFeedbackCount = distinctNegativeFeedbackAssignments(employee.negFeedbackDetails);
  const negFeedbackSuggestion = negativeFeedbackSuggestion(negFeedbackCount);
  const negFeedbackFires = negFeedbackSuggestion != null;
  const negReason = negFeedbackReason(negFeedbackCount, negFeedbackSuggestion);

  const payScale = employee.netPayableDetails?.PayScale != null ? Number(employee.netPayableDetails.PayScale) : null;
  const tier = trainerSalaryTier(payScale);
  if (tier == null) return { status: negFeedbackFires ? 'fired' : 'no-salary-data', negFeedbackSuggestion, rule: negReason };

  const bands = BANDS_BY_TIER[tier];
  const tenureDays = employee.tenure ?? 0;
  // Last band whose minDays the employee has reached — bands are ordered
  // ascending, so this is the most specific match.
  const band = [...bands].reverse().find((b) => tenureDays >= b.minDays);

  const rule = negFeedbackFires ? (band.rule ? `${band.rule}; ${negReason}` : negReason) : band.rule;
  return { status: negFeedbackFires ? 'fired' : band.check(employee), tier, band: band.label, rule, negFeedbackSuggestion };
}

// --- Sales PA Algo -----------------------------------------------------
// Flags Sales reps (CCEs) whose Net Revenue (NR) falls below the bar
// expected for their tenure, per HR's spec — split by India-based vs
// Overseas-based (employees.is_overseas, from syncEmployeeDetails), since
// the two use entirely different measures: India compares average monthly
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

// Each check receives { total, nrMonthlyDetails, payScale } (total NR since
// joining, the raw monthly history for avgNR to window, and payScale from
// net_payable_details.PayScale) and returns 'fired' | 'clear' | 'no-data'.
// `months` (undefined = every month on file) picks the averaging window —
// see avgNR above.
function roiCheck(threshold) {
  return ({ total }) => (total == null ? 'no-data' : total < threshold ? 'fired' : 'clear');
}
function salaryMultipleCheck(multiple, months) {
  return ({ nrMonthlyDetails, payScale }) => {
    const avg = avgNR(nrMonthlyDetails, months);
    if (avg == null || payScale == null) return 'no-data';
    return avg / payScale < multiple ? 'fired' : 'clear';
  };
}
function avgThresholdCheck(threshold, months) {
  return ({ nrMonthlyDetails }) => {
    const avg = avgNR(nrMonthlyDetails, months);
    return avg == null ? 'no-data' : avg < threshold ? 'fired' : 'clear';
  };
}

const INR = (n) => '₹' + n.toLocaleString('en-IN');

// Tenure bands, oldest first, per HR's spec. 0-3 months has no applicable
// rule at all (the spec's table starts at 3-6 months) — always 'no-data'
// there rather than a silent pass.
const SALES_BANDS = [
  {
    minDays: 0, label: '0-3 months',
    india: { rule: 'No PA Algo criteria for under 3 months tenure', check: () => 'no-data' },
    overseas: { rule: 'No PA Algo criteria for under 3 months tenure', check: () => 'no-data' },
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

// Returns:
//   { status: 'no-country-data' }                        — is_overseas not synced yet (syncEmployeeDetails), can't tell which column of the spec applies
//   { status: 'no-data', band, rule, region }             — matched a band, but it needs NR/salary data we don't have
//   { status: 'clear', band, rule, region }                — matched a band, condition did not fire
//   { status: 'fired', band, rule, region }                — matched a band, condition fired — PA Algo candidate
export function computeSalesPaAlgoFlag(employee) {
  if (employee.isOverseas == null) return { status: 'no-country-data' };
  const isOverseas = employee.isOverseas === true || employee.isOverseas === 1;

  const tenureDays = employee.tenure ?? 0;
  const band = [...SALES_BANDS].reverse().find((b) => tenureDays >= b.minDays);
  const spec = isOverseas ? band.overseas : band.india;

  const total = totalNR(employee.nrMonthlyDetails);
  const payScale = employee.netPayableDetails?.PayScale != null ? Number(employee.netPayableDetails.PayScale) : null;

  return {
    status: spec.check({ total, nrMonthlyDetails: employee.nrMonthlyDetails, payScale }),
    band: band.label,
    rule: spec.rule,
    region: isOverseas ? SALES_REGIONS.OVERSEAS : SALES_REGIONS.INDIA,
  };
}
