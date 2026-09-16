// Plain constants, no server-only imports — safe for both server code
// (lib/jobStatus.js) and client components (app/DashboardClient.js) to import.
export const JOB_LABELS = {
  weeklyreport: 'Weekly NJ Check-In email (daily 9AM IST)',
  weeklyresponsereport: 'Weekly NJ Response Report + Shoddy auto-mark (Wed 6PM IST)',
  report15: '15-Day Report',
};
