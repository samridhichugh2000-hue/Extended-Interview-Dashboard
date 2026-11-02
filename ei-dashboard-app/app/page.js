import DashboardClient from './DashboardClient';
import { getEmployees, getWeeklyResponses, getGraphMeetings, slimEmployeesForClient, attachExternalMeetingDates } from '../lib/queries';
import { getNewJoiners } from '../lib/koenigApi';
import { getIsoWeek } from '../lib/weekUtils';
import { getFailedJobRuns, getFeedRuns } from '../lib/jobStatus';
import { loadCsmSeasonality } from '../lib/csmSeasonal';
import { getDb } from '../lib/db';

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
  const week = getIsoWeek(new Date());
  const [employees, responses, rawNewJoiners, failedJobs, graphMeetings, feedRuns] = await Promise.all([
    getEmployees(),
    getWeeklyResponses(week),
    // External API — degrade to an empty list rather than take down the whole
    // dashboard if Koenig is unreachable or its env vars aren't configured.
    getNewJoiners(from, to).catch((err) => {
      console.error('Koenig NJ API failed:', err.message);
      return null;
    }),
    getFailedJobRuns(),
    getGraphMeetings(),
    getFeedRuns(),
  ]);

  // Last year's CSM month-by-month pattern, for the seasonal-adjusted NR view; a failure just hides that view's adjustment.
  const csmSeasonality = await loadCsmSeasonality(getDb(), employees).catch((err) => { console.error('CSM seasonality failed:', err.message); return {}; });

  // "Blue Collared" is excluded from every section, and anyone Koenig reports
  // as exited (DOR/LWD set) shouldn't count as an NJ under watch anywhere —
  // drop both before this reaches the UI at all.
  // When the live call fails (Koenig has answered "Forbidden" to the production server while the same
  // credentials work elsewhere) the counts fall back to the employees table, which the daily Koenig
  // sync keeps current — same 6-month window — instead of showing 0 on every badge. Only the counts are
  // used from this list, so a minimal row is enough.
  const sixMonthDays = Math.round((new Date(to) - new Date(from)) / 86400000);
  const liveNewJoiners = rawNewJoiners && rawNewJoiners.length ? rawNewJoiners : null;
  if (!liveNewJoiners) console.error('New-joiner counts: using the employees table (live Koenig list unavailable).');
  const newJoiners = (liveNewJoiners || employees
    .filter((e) => e.active !== false && e.tenure != null && e.tenure <= sixMonthDays && ['Sales', 'Trainer', 'PT Team', 'FM Team', 'Recruitment Team'].includes(e.team))
    .map((e) => ({ empId: e.id, name: e.name, section: e.team, active: true, joiningDate: e.doj, managerName: e.manager })))
    .filter((nj) => nj.section !== null && nj.active !== false);
  const deptCounts = { Sales: 0, Trainer: 0, 'PT Team': 0, 'FM Team': 0, 'Recruitment Team': 0 };
  for (const nj of newJoiners) deptCounts[nj.section]++;

  return <DashboardClient employees={attachExternalMeetingDates(slimEmployeesForClient(employees), graphMeetings)} responses={responses} week={week} newJoiners={newJoiners} deptCounts={deptCounts} failedJobs={failedJobs} graphMeetings={graphMeetings} feedRuns={feedRuns} csmSeasonality={csmSeasonality} />;
}
