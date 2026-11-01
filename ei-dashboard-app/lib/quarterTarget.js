import { quarterMonthKeys } from './paAlgo.js';

// Current quarter's CSM target (lib/syncRunners.js's syncTargetsData,
// quarter_target_amount) against this quarter's synced NR — Koenig's own
// achievement-percentage feed (quarter_target_pct, syncTargetAchievement)
// has returned zero rows for every query tried, so the % here is computed
// directly from NR rather than trusting that feed.
export function quarterTargetFor(e, mode, q) {
  const qt = (e.quarterTargets || []).find((t) => t.name === q.name && t.year === q.year);
  if (!qt) return null;
  const targetAmount = qt.amount;
  const targetType = qt.type;
  const monthKeys = quarterMonthKeys(q);
  // One row per quarter month (0 when the feed has nothing for it), so the
  // breakdown popup always shows all three months.
  // Manager-level (ASM) targets are crore-scale team targets: achieved is the
  // manager's own NR plus their team's (direct reports, from the NR API's
  // Manager field). Individual CSM/CM targets stay own-NR only.
  const withTeam = targetType === 'ASM' && !!e.teamNrDetails;
  // A month of the quarter that has not started yet has no actual NR, so what is
  // already booked for it (Future NR) is used — the quarter total is the actual
  // months plus those booked months.
  const futureOf = (list, key) => (list || []).find((m) => m.month === key);
  const breakdown = monthKeys.map((key) => {
    const ownActual = (e.nrMonthlyDetails || []).find((m) => m.month === key);
    const ownFuture = ownActual ? null : futureOf(e.nrFutureDetails, key);
    const own = ownActual ? (ownActual.nr ?? 0) : (ownFuture?.nr ?? 0);
    const teamActual = withTeam ? futureOf(e.teamNrDetails, key) : null;
    const team = teamActual?.nr ?? 0;
    const trueRow = (e.trueNrDetails || []).find((m) => m.month === key);
    return { month: key, own, team, nr: own + team, trueNr: trueRow ? trueRow.trueNr : null, isFuture: !ownActual && !!ownFuture };
  });
  // True NR mode: achieved from True NR (own only — a manager's team True NR isn't available), counting only the months Koenig has returned so far.
  if (mode === 'true') {
    if (withTeam) return { unavailable: 'Team True NR not available' };
    const trueMonths = breakdown.filter((m) => m.trueNr != null);
    const trueTotal = trueMonths.reduce((sum, m) => sum + m.trueNr, 0);
    const tp = targetAmount > 0 ? Math.round((trueTotal / targetAmount) * 1000) / 10 : null;
    const lk = (n) => '₹' + (n / 100000).toFixed(1) + 'L';
    return { pct: tp != null ? `${tp}%` : '—', achieved: tp != null && tp >= 100, nrLabel: lk(trueTotal), targetLabel: lk(targetAmount), q, breakdown, withTeam: false, teamSize: 0, isTrue: true, monthsAvailable: trueMonths.length };
  }
  const nr = breakdown.reduce((sum, m) => sum + m.nr, 0);
  const pct = targetAmount > 0 ? Math.round((nr / targetAmount) * 1000) / 10 : null;
  const lakhs = (n) => '₹' + (n / 100000).toFixed(1) + 'L';
  return { pct: pct != null ? `${pct}%` : '—', achieved: pct != null && pct >= 100, nrLabel: lakhs(nr), targetLabel: lakhs(targetAmount), q, breakdown, withTeam, teamSize: e.teamNrDetails?.[0]?.members ?? 0 };
}
