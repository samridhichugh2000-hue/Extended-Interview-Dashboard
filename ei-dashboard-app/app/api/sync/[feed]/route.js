import { NextResponse } from 'next/server';
import { SYNC_RUNNERS } from '../../../../lib/syncRunners';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Each feed is meant to complete comfortably under Vercel Hobby's 60s
// function limit on its own — that's why this is one route per feed instead
// of the single sync-all.mjs script, which took ~4.5 minutes for all 14
// combined. Triggered by an external scheduler (cron-job.org) rather than
// Vercel Cron, since Hobby caps Vercel's own Cron Jobs at 2 per project.
async function handle(request, { params }) {
  const { feed } = params;

  const provided = request.headers.get('x-sync-secret') || new URL(request.url).searchParams.get('secret');
  if (!process.env.SYNC_TRIGGER_SECRET || provided !== process.env.SYNC_TRIGGER_SECRET) {
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
