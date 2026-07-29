const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Separate credentials/role from the other Koenig integrations, so cache the
// token under its own module-level variable.
let tokenCache = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_TECHCALL_API_USERNAME,
      userPassword: process.env.KOENIG_TECHCALL_API_PASSWORD,
      userRole: process.env.KOENIG_TECHCALL_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Tech Call GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Tech Call GetToken error: ${json.message}`);
  return { accessToken: json.content.accessToken, deviceToken: json.content.deviceToken };
}

async function getToken({ forceRefresh = false } = {}) {
  if (!tokenCache || forceRefresh) tokenCache = await fetchToken();
  return tokenCache;
}

// Get Tech Call Data for CSM — per-employee like exam summary/skills. Every
// probe against the live feed so far (every current Sales employee, and a
// spread of arbitrary EmpIds) returned the API's own
// "No matching record found" placeholder row rather than real data, so the
// actual field names for a genuine record are unconfirmed. Rows are passed
// through as-is (raw) instead of mapped to named fields, so whatever shape
// real data turns out to have still displays reasonably once it exists.
export async function getTechCalls(empCode) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_TECHCALL_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmpId: String(empCode), CSMName: '' }),
    });
    if (!res.ok) throw new Error(`Koenig Tech Call common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Tech Call common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  if (!rows || !rows.length) return [];
  if (rows.length === 1 && rows[0].Message) return []; // "No matching record found" placeholder
  return rows;
}
