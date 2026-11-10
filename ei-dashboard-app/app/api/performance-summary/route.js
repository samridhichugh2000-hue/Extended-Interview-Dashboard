import { NextResponse } from 'next/server';
import { getEmployees } from '../../../lib/queries';
import { buildPerformanceSummary } from '../../../lib/performanceSummary';
import {
  getQuarterState, getAlreadyEmailed, setExcluded, sendSummaryBatch,
} from '../../../lib/performanceSummaryStore';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// State the PA/PIP "CSMs below 30%" tab needs besides the employee list it already has: who HR unchecked,
// what has been sent, and who already got this quarter's summary before the tab existed (Sent Items).
export async function GET() {
  try {
    const summary = buildPerformanceSummary([]);
    const state = await getQuarterState(summary.key);
    let emailed = {};
    let emailedError = null;
    try { emailed = Object.fromEntries(await getAlreadyEmailed(summary.quarter)); } catch (err) { emailedError = err.message; }
    return NextResponse.json({ ok: true, key: summary.key, ...state, emailed, emailedError });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === 'exclude') {
      const key = buildPerformanceSummary([]).key;
      await setExcluded(key, String(body.empId), !!body.excluded);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'send') {
      const result = await sendSummaryBatch(await getEmployees(), { empIds: body.empIds || [] });
      return NextResponse.json({ ok: result.failed.length === 0, ...result });
    }
    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
