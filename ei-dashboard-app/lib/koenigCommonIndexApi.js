const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Separate credentials/role from the other Koenig integrations, so cache the
// token under its own module-level variable.
let tokenCache = null;
let tokenPromise = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_COMMONINDEX_API_USERNAME,
      userPassword: process.env.KOENIG_COMMONINDEX_API_PASSWORD,
      userRole: process.env.KOENIG_COMMONINDEX_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Common Index GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Common Index GetToken error: ${json.message}`);
  return { accessToken: json.content.accessToken, deviceToken: json.content.deviceToken };
}

async function getToken({ forceRefresh = false } = {}) {
  if (forceRefresh) { tokenCache = null; tokenPromise = null; }
  if (tokenCache) return tokenCache;
  if (!tokenPromise) {
    tokenPromise = fetchToken()
      .then((t) => { tokenCache = t; return t; })
      .finally(() => { tokenPromise = null; });
  }
  return tokenPromise;
}

// Get Common Index Total Points for a single EmpCode — per-employee only,
// same as Net Payable. EmpCode must be the bare numeric id (no "EMP" prefix,
// confirmed live: a string like "EMP4882" 500s with "Error converting data
// type nvarchar to int"). An empty/unknown EmpCode doesn't error, it just
// returns a dummy {EmpId: 0 or the code, TotalPoint: 0} row, so there's no
// way to detect "employee not found" from this API — every call is treated
// as a real (possibly zero) point total.
export async function getCommonIndexPoints(empCode) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_COMMONINDEX_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmpCode: String(empCode) }),
    });
    if (!res.ok) throw new Error(`Koenig Common Index common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Common Index common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  if (!rows || !rows.length) return null;
  return rows[0].TotalPoint;
}
