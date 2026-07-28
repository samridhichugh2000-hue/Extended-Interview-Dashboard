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
  const [employees, responses, newJoiners] = await Promise.all([
    getEmployees(),
    getWeeklyResponses('2026-W30'),
    // External API — degrade to an empty list rather than take down the whole
    // dashboard if Koenig is unreachable or its env vars aren't configured.
    getNewJoiners(from, to).catch((err) => {
      console.error('Koenig NJ API failed:', err.message);
      return [];
    }),
  ]);
  return <DashboardClient employees={employees} responses={responses} newJoiners={newJoiners} />;
}
