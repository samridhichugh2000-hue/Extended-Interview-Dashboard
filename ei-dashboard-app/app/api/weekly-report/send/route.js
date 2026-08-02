import { NextResponse } from 'next/server';
import { sendWeeklyReports } from '../../../../lib/weeklyReportRunner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Same-origin only — called from the Reports screen's "Send now" button
// inside this app's own client bundle, not by a third party crossing the
// internet like cron-job.org hitting /api/sync/[feed]. No secret gate here:
// embedding one in client-side code would just leak it in the bundle. This
// matches the app's existing security posture (no per-request auth on any
// UI-facing path today). A real cron, if wired up later, should go through
// /api/sync/weeklyreport instead, which already has the secret gate.
export async function POST() {
  try {
    const result = await sendWeeklyReports();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
