import { NextResponse } from 'next/server';
import { sendReport15 } from '../../../../lib/report15Runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Same-origin only, mirrors /api/weekly-report/send — called from the
// Reports screen's "Send now" button inside this app's own client bundle.
export async function POST() {
  try {
    const result = await sendReport15();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
