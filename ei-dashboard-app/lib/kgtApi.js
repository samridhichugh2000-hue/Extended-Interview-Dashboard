const BASE_URL = process.env.POLLS_API_BASE_URL;

// KGT (ownership-transfer request) participation — per-employee, matched by
// emp_code, from the same standalone Polls Dashboard service as
// lib/pollsApi.js (shares its base URL/key — the polls dashboard scopes
// them to the same API key on its side). A 404 means the polls dashboard
// has no employee record for this code at all — distinct from a genuine 0
// (kgt_count: 0, kgts: []), which comes back as a normal 200.
export async function getKgtParticipation(empCode) {
  const url = `${BASE_URL}/api/public/kgt-participation?emp_code=${encodeURIComponent(empCode)}`;
  const res = await fetch(url, { headers: { 'x-api-key': process.env.POLLS_API_KEY } });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KGT participation API failed: ${res.status} ${res.statusText}`);

  const json = await res.json();
  return { count: json.kgt_count ?? 0, kgts: json.kgts ?? [] };
}
