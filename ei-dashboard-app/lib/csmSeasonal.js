// CSM NR before/after an appraisal, RnR award, PA or PIP — adjusted for
// seasonality. The change in a CSM's own NR is measured as usual (see
// lib/analysis.js), but a month of the year is not the same as any other: NR
// dips and peaks with the calendar. So the "before" average is carried forward
// by how last year's same months moved (the after-months of last year against
// the before-months of last year) to get the NR the person would have had from
// season alone. Actual NR above that is a real gain, below it a real dip.
//
// The NR feed only reaches back to May 2025, so the seasonal pattern comes from
// True NR — which goes back to 2020 — of the tenured CSMs (joined before the
// period, still here), averaged per person so headcount changes don't skew it.
// Every person's before and after are NR only.

import { computeEventImpact, appraisalWindow } from './analysis.js';

export const isCsm = (e) => e.team === 'Sales' && /customer success|\bcsm\b/i.test(e.designation || '');

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ymKey = (idx) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
function dojIdx(doj) {
  const m = /^\d{1,2}\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{2,4})$/.exec(String(doj || '').trim());
  if (!m) return null;
  const mi = MON.indexOf(m[1].toLowerCase());
  return mi < 0 ? null : (Number(m[2]) < 100 ? 2000 + Number(m[2]) : Number(m[2])) * 12 + mi;
}

// Server side: { 'YYYY-MM': average True NR per tenured CSM } for 2023-01..2025-12.
let cache = null;
export async function loadCsmSeasonality(db, employees) {
  if (cache && Date.now() - cache.at < 12 * 3600 * 1000) return cache.index;
  const tenured = employees.filter((e) => isCsm(e) && e.active && (dojIdx(e.doj) ?? 1e9) <= 2023 * 12);
  if (!tenured.length) return {};
  const ids = tenured.map((e) => e.id);
  const rs = await db.execute({
    sql: `SELECT month, value FROM employee_monthly_history WHERE metric = 'true_nr' AND month BETWEEN '2023-01' AND '2025-12' AND employee_id IN (${ids.map(() => '?').join(',')})`,
    args: ids,
  });
  const tot = {};
  for (const r of rs.rows) tot[r.month] = (tot[r.month] || 0) + Number(r.value || 0);
  const index = {};
  for (const [m, v] of Object.entries(tot)) index[m] = v / tenured.length;
  cache = { at: Date.now(), index };
  return index;
}

// last-year-same-month level for a set of month indexes
function lastYearMean(index, [from, to]) {
  const vals = [];
  for (let i = from; i <= to; i++) { const v = index[ymKey(i - 12)]; if (v == null) return null; vals.push(v); }
  return vals.reduce((s, x) => s + x, 0) / vals.length;
}

// One CSM around one event -> { before, after, expected, seasonalPct, delta, adjDelta, adjPct } (NR per month) or null.
export function csmSeasonalImpact(e, eventDate, months, index) {
  const imp = computeEventImpact(e, eventDate, months);
  const nr = imp.metrics?.nr;
  if (!nr) return null;
  const win = appraisalWindow(eventDate, months);
  const lyBefore = lastYearMean(index, win.before), lyAfter = lastYearMean(index, win.after);
  const seasonal = lyBefore && lyAfter != null ? lyAfter / lyBefore : null;
  const out = { eventDate, k: imp.k, before: nr.before, after: nr.after, delta: nr.delta, seasonalFactor: seasonal };
  if (seasonal == null) return out;
  out.expected = nr.before * seasonal;
  out.adjDelta = nr.after - out.expected;
  out.adjPct = out.expected > 0 ? (nr.after / out.expected - 1) * 100 : null;
  return out;
}

// Totals across a list of per-CSM results (each from csmSeasonalImpact, with .e).
export function consolidate(results) {
  const counted = results.filter((r) => r.expected != null);
  const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
  const before = sum(counted, (r) => r.before), after = sum(counted, (r) => r.after), expected = sum(counted, (r) => r.expected);
  return {
    people: results.length,
    counted: counted.length,
    noSeasonal: results.length - counted.length,
    before, after, expected,
    rawDelta: after - before,
    rawPct: before > 0 ? (after / before - 1) * 100 : null,
    seasonalDelta: expected - before,
    adjDelta: after - expected,
    adjPct: expected > 0 ? (after / expected - 1) * 100 : null,
    up: counted.filter((r) => r.adjDelta > 0).length,
    down: counted.filter((r) => r.adjDelta < 0).length,
  };
}
