import DashboardClient from './DashboardClient';
import { getEmployees, getWeeklyResponses } from '../lib/queries';
import { getNewJoiners } from '../lib/koenigApi';

export const dynamic = 'force-dynamic';

function sixMonthsAgo() {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 6);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

export default async function Page() {
  const { from, to } = sixMonthsAgo();
  const [employees, responses, rawNewJoiners] = await Promise.all([
    getEmployees(),
    getWeeklyResponses('2026-W30'),
    // External API — degrade to an empty list rather than take down the whole
    // dashboard if Koenig is unreachable or its env vars aren't configured.
    getNewJoiners(from, to).catch((err) => {
      console.error('Koenig NJ API failed:', err.message);
      return [];
    }),
  ]);

  // "Blue Collared" is excluded from every section, and anyone Koenig reports
  // as exited (DOR/LWD set) shouldn't count as an NJ under watch anywhere —
  // drop both before this reaches the UI at all.
  const newJoiners = rawNewJoiners.filter((nj) => nj.section !== null && nj.active !== false);
  const deptCounts = { Sales: 0, Trainer: 0, 'PT Team': 0 };
  for (const nj of newJoiners) deptCounts[nj.section]++;

  return <DashboardClient employees={employees} responses={responses} newJoiners={newJoiners} deptCounts={deptCounts} />;
}
