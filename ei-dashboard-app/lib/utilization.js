// Trainer utilization — how a month's SC / Non-SC hours become the single
// utilization % shown on the dashboard and used by the Trainer PA Algo.
//
//   utilization % = SC hours / capacity * 100
//                 + min(Non-SC hours / capacity * 100, NON_SC_UTIL_CAP)
//
// i.e. Non-SC (non-Scheduled-Class) work counts towards utilization, but only
// up to NON_SC_UTIL_CAP percentage points — SC delivery is what really
// counts. Plain constants, no server-only imports.
//
// UTIL_CAPACITY_HOURS: 176 = 22 working days x 8h. Inferred from Koenig's own
// combined feed, whose displayed percentage tracked total hours / 176 (e.g.
// 104h -> 59%, 158h -> 89%) — worth confirming with Koenig if the monthly
// capacity is ever defined differently.
export const UTIL_CAPACITY_HOURS = 176;
export const NON_SC_UTIL_CAP = 15;

const round1 = (n) => Math.round(n * 10) / 10;

export function computeUtilization(scHours, nonScHours) {
  const scUtil = (scHours / UTIL_CAPACITY_HOURS) * 100;
  const nonScUtil = Math.min((nonScHours / UTIL_CAPACITY_HOURS) * 100, NON_SC_UTIL_CAP);
  return { scUtil: round1(scUtil), nonScUtil: round1(nonScUtil), util: round1(scUtil + nonScUtil) };
}
