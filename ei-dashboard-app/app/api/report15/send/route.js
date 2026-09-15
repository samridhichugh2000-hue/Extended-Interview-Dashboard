import { NextResponse } from 'next/server';
import { sendReport15 } from '../../../../lib/report15Runner';
import { recordJobRun } from '../../../../lib/jobStatus';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Same-origin only, mirrors /api/weekly-report/send — called from the
// Reports screen's "Send now" button inside this app's own client bundle.
export async function POST() {
  try {
    const result = await sendReport15();
    await recordJobRun('report15', true, result?.message);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    await recordJobRun('report15', false, err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
