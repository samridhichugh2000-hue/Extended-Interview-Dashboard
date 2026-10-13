import { NextResponse } from 'next/server';
import { getEiHistory, getEiSnapshot } from '../../../../../lib/eiSnapshots';

export const dynamic = 'force-dynamic';

// EI Index history for the "Score history" popup: the daily score series for
// ?window=all|3month, plus the full signal break-up of ?date=YYYY-MM-DD when
// asked. Behind the same Basic Auth gate as the rest of the dashboard.
export async function GET(request, { params }) {
  const q = new URL(request.url).searchParams;
  const window = q.get('window') === '3month' ? '3month' : 'all';
  const date = q.get('date');
  const history = await getEiHistory(params.id, window, 400);
  const snapshot = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? await getEiSnapshot(params.id, window, date) : null;
  return NextResponse.json({ window, history, snapshot });
}
