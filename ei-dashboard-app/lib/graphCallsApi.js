import { graphFetch } from './graphAuth.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// How much earlier/later than the calendar's scheduled start still counts as
// "on time" — 2 minutes of grace either side.
export const ON_TIME_GRACE_SECONDS = 120;

async function graphJson(url, options) {
  const res = await graphFetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Graph request failed: ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// Outlook's "return times in UTC" preference sends dateTime strings with no
// zone suffix (and sometimes 7-digit fractional seconds) — trim to
// millisecond precision and add Z so `new Date()` parses them reliably. Also
// used for attendanceReport timestamps, which already carry a Z but can have
// the same over-precise fractional seconds.
export function parseGraphDateTime(s) {
  if (!s) return null;
  const trimmed = s.replace(/(\.\d{3})\d*/, '$1');
  return new Date(/Z$|[+-]\d{2}:\d{2}$/.test(trimmed) ? trimmed : `${trimmed}Z`);
}

// Every Teams meeting on `userEmail`'s calendar between fromIso/toIso, pages
// through @odata.nextLink. Requesting UTC back (Prefer header) keeps every
// timestamp in this module on the same clock, so delay/duration math never
// has to cross timezones.
export async function getCalendarTeamsMeetings(userEmail, fromIso, toIso) {
  let url = `${GRAPH_BASE}/users/${encodeURIComponent(userEmail)}/calendarView?` + new URLSearchParams({
    startDateTime: fromIso,
    endDateTime: toIso,
    $select: 'subject,start,end,isOnlineMeeting,onlineMeetingProvider,onlineMeeting,organizer',
    $top: '50',
  });
  const headers = { Prefer: 'outlook.timezone="UTC"' };
  const events = [];
  while (url) {
    const json = await graphJson(url, { headers });
    events.push(...(json.value || []));
    url = json['@odata.nextLink'] || null;
  }
  return events.filter((e) => e.isOnlineMeeting && e.onlineMeetingProvider === 'teamsForBusiness' && e.onlineMeeting?.joinUrl);
}

// Application-permission calls to /users/{id}/onlineMeetings/... require the
// organizer's AAD object id (a GUID) — unlike most other /users/{id}
// endpoints, they 400 ("userId in request URL is not a valid GUID") if
// given an email/UPN instead. Resolve once per organizer before calling
// resolveOnlineMeeting/getAttendanceReports below. Returns null for a
// non-existent/external address rather than throwing.
export async function resolveUserIdByEmail(email) {
  try {
    const user = await graphJson(`${GRAPH_BASE}/users/${encodeURIComponent(email)}?$select=id`);
    return user?.id || null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// Resolves a calendar event's joinUrl to the actual Teams online meeting
// object (its `id` is what attendanceReports hang off). Must be queried
// against the organizer's own mailbox (by AAD object id — see
// resolveUserIdByEmail above) — app-only OnlineMeetings.Read.All can't
// resolve a meeting from an attendee's side. Returns null (not a throw) when
// nothing matches, e.g. a meeting organized outside this tenant.
export async function resolveOnlineMeeting(organizerId, joinUrl) {
  const url = `${GRAPH_BASE}/users/${organizerId}/onlineMeetings?` + new URLSearchParams({
    $filter: `JoinWebUrl eq '${joinUrl.replace(/'/g, "''")}'`,
  });
  const json = await graphJson(url);
  return json.value?.[0] || null;
}

// A recurring/reconvened meeting can produce more than one report — callers
// match their own participant across all of them.
export async function getAttendanceReports(organizerId, meetingId) {
  const url = `${GRAPH_BASE}/users/${organizerId}/onlineMeetings/${meetingId}/attendanceReports?$expand=attendanceRecords`;
  const json = await graphJson(url);
  return json.value || [];
}

// callRecord.organizer only exposes an AAD object id (no email/UPN), while
// graph_meetings.organizer_email comes from the calendar side — resolve the
// id to an address so the two can be matched. Returns null for a
// non-existent/external id rather than throwing.
export async function resolveUserEmailById(aadId) {
  try {
    const user = await graphJson(`${GRAPH_BASE}/users/${aadId}?$select=mail,userPrincipalName`);
    return user?.mail || user?.userPrincipalName || null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// There is no list/filter endpoint for call records — Graph only tells you a
// record exists via a webhook notification carrying its id (see
// createCallRecordsSubscription below and app/api/graph/callrecords-webhook).
export async function getCallRecord(id) {
  return graphJson(`${GRAPH_BASE}/communications/callRecords/${id}?$expand=sessions`);
}

export async function createCallRecordsSubscription(notificationUrl, clientState, expirationDateTime) {
  return graphJson(`${GRAPH_BASE}/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      changeType: 'created',
      notificationUrl,
      resource: 'communications/callRecords',
      expirationDateTime,
      clientState,
    }),
  });
}

export async function renewSubscription(id, expirationDateTime) {
  return graphJson(`${GRAPH_BASE}/subscriptions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expirationDateTime }),
  });
}
