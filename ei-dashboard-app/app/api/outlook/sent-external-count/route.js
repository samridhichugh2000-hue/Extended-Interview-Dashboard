import { NextResponse } from 'next/server';
import { getSentExternalSummary } from '../../../../lib/graphMailer';

export const dynamic = 'force-dynamic';

// GET /api/outlook/sent-external-count?email=...&from=2026-08-01&to=2026-09-15
// `from`/`to` are plain dates (no time) — widened to the full day in either
// direction so "from=X&to=X" covers that whole day rather than matching
// nothing.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!email) {
    return NextResponse.json({ ok: false, error: '`email` query param is required.' }, { status: 400 });
  }

  const fromIso = from ? `${from}T00:00:00Z` : null;
  const toIso = to ? `${to}T23:59:59Z` : null;

  try {
    const { recipients, daily } = await getSentExternalSummary(email, fromIso, toIso);
    return NextResponse.json({
      ok: true,
      email,
      from: from || null,
      to: to || null,
      externalAddressCount: recipients.length,
      totalExternalEmailsSent: recipients.reduce((sum, r) => sum + r.count, 0),
      recipients,
      daily: [...daily.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status || 500 });
  }
}
