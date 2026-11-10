import { quarterTrueNr } from './quarterTrueNr.js';

// Target achievement for a quarter: the quarter's CSM target (lib/syncRunners.js's syncTargetsData) against the
// employee's True NR from the Koenig API for all three months of that quarter (see lib/quarterTrueNr.js).
// The second argument is ignored — it is kept only so existing callers don't change; there is no other mode.
export function quarterTargetFor(e, _mode, q) {
  const qt = (e.quarterTargets || []).find((t) => t.name === q.name && t.year === q.year);
  if (!qt) return null;
  const targetAmount = qt.amount;
  // Manager-level (ASM) targets are crore-scale team targets; a team's True NR is not available, so no % is shown.
  if (qt.type === 'ASM') return { unavailable: 'Team True NR not available' };
  const t = quarterTrueNr(e, q);
  const breakdown = t.months.map((m) => ({ month: m.month, trueNr: m.trueNr, isFuture: m.isFuture }));
  const tp = targetAmount > 0 ? Math.round((t.total / targetAmount) * 1000) / 10 : null;
  const lk = (n) => '₹' + (n / 100000).toFixed(1) + 'L';
  return {
    pct: tp != null ? `${tp}%` : '—',
    achieved: tp != null && tp >= 100,
    nrLabel: lk(t.total),
    targetLabel: lk(targetAmount),
    q,
    breakdown,
    withTeam: false,
    teamSize: 0,
    isTrue: true,
    monthsAvailable: t.monthsAvailable,
  };
}
