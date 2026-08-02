const BASE_URL = process.env.POLLS_API_BASE_URL;

// Employee participation — per-employee, matched by email. Unlike the Koenig
// feeds, this is a plain API-key header, no access/device token exchange.
// A 404 ("No employee found for this email") means the polls dashboard
// doesn't recognize this email at all — distinct from a genuine 0, which
// comes back as a normal 200 with polls_participated: 0.
export async function getPollsParticipation(email) {
  const url = `${BASE_URL}/api/public/employee-participation?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: { 'x-api-key': process.env.POLLS_API_KEY } });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Polls participation API failed: ${res.status} ${res.statusText}`);

  const json = await res.json();
  return { participated: json.polls_participated ?? 0 };
}
