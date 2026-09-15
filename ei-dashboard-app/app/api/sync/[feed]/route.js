import { NextResponse } from 'next/server';
import { SYNC_RUNNERS } from '../../../../lib/syncRunners';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Each feed is meant to complete comfortably under Vercel Hobby's 60s
// function limit on its own — that's why this is one route per feed instead
// of the single sync-all.mjs script, which took ~4.5 minutes for all 14
// combined. Hobby caps Vercel's own Cron Jobs at 2 per project, so only
// `weeklyreport` and `weeklyresponsereport` use native Vercel Cron
// (schedules in vercel.json) — the other 12 feeds are triggered by an
// external scheduler (cron-job.org) hitting this same secret-gated route.
async function handle(request, { params }) {
  const { feed } = params;

  // Two valid callers: cron-job.org (external scheduler, sends x-sync-secret
  // or ?secret=) and Vercel Cron (sends `Authorization: Bearer <CRON_SECRET>`
  // automatically whenever a CRON_SECRET env var is set — see
  // https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
  const provided = request.headers.get('x-sync-secret') || new URL(request.url).searchParams.get('secret');
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const authorized =
    (process.env.SYNC_TRIGGER_SECRET && provided === process.env.SYNC_TRIGGER_SECRET) ||
    (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const runner = SYNC_RUNNERS[feed];
  if (!runner) {
    return NextResponse.json({ error: `Unknown feed "${feed}". Valid feeds: ${Object.keys(SYNC_RUNNERS).join(', ')}` }, { status: 404 });
  }

  const startedAt = new Date().toISOString();
  try {
    const result = await runner();
    return NextResponse.json({ feed, startedAt, finishedAt: new Date().toISOString(), ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ feed, startedAt, finishedAt: new Date().toISOString(), ok: false, error: err.message }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
