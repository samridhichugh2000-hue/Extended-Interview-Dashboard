import DashboardClient from './DashboardClient';
import { getEmployees, getWeeklyResponses } from '../lib/queries';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [employees, responses] = await Promise.all([
    getEmployees(),
    getWeeklyResponses('2026-W30'),
  ]);
  return <DashboardClient employees={employees} responses={responses} />;
}
