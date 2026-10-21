const BASE_URL = process.env.SCHEDULED_CALLS_API_BASE_URL || 'https://outreach-dashboard-navy.vercel.app';

export const FM_INTERVIEWS_LOOKBACK_DAYS = 30;

// Interviews scheduled per Field Manager, from the standalone Outreach
// Dashboard's scheduled-calls service. Keyed by lowercased FM email; each
// value is { total, byDate: [{ date, count, by_source }] }. Only FMs with at
// least one interview in the window are returned by the API, so an FM missing
// from the map has a genuine 0 for the window, not an unknown.
export async function getFmInterviews(from, to) {
  const url = `${BASE_URL}/api/scheduled-calls/fm-summary?from=${from}&to=${to}`;
  const res = await fetch(url, { headers: { 'x-api-key': process.env.SCHEDULED_CALLS_API_KEY } });
  if (!res.ok) throw new Error(`FM interviews API failed: ${res.status} ${res.statusText}`);

  const json = await res.json();
  const byEmail = new Map();
  for (const fm of json.fms ?? []) {
    if (!fm.fm_email) continue;
    byEmail.set(fm.fm_email.toLowerCase(), { total: fm.total_interviews ?? 0, byDate: fm.by_date ?? [] });
  }
  return byEmail;
}
