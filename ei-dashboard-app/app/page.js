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
    getNewJoiners(from, to),
  ]);
  return <DashboardClient employees={employees} responses={responses} newJoiners={newJoiners} />;
}
