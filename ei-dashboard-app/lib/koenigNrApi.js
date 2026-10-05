const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Separate credentials/role (NR) from the other Koenig integrations, so
// cache the token under its own module-level variable.
let tokenCache = null;
let tokenPromise = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_NR_API_USERNAME,
      userPassword: process.env.KOENIG_NR_API_PASSWORD,
      userRole: process.env.KOENIG_NR_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Employee NR GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Employee NR GetToken error: ${json.message}`);
  return { accessToken: json.content.accessToken, deviceToken: json.content.deviceToken };
}

// GetToken invalidates any previously issued token for these credentials, so
// concurrent callers racing to fetch their own token would keep invalidating
// each other's — memoize the in-flight request so they share one fetch.
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

// Get Employee NR Without Salary and Marketing Cost — one call, empty body, no
// date range: returns one row per CCE with a fixed 24-month window of monthly
// columns ("May-2025" .. "Apr-2027", zero-filled before joining and for
// months still to come) as Indian-format strings ("1,79,537"). The row
// carries Manager and CCE (name, often with a trailing "-" or nickname) but,
// for now, no EmpId — an EmpId/EmpCode field is picked up automatically if
// Koenig adds one.
const MONTH_KEY = /^[A-Z][a-z]{2}-\d{4}$/;
const EMP_ID_KEY = /^(emp[_ ]?(id|code)|employee[_ ]?(id|code))$/i;

export async function getEmployeeNr() {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_NR_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`Koenig Employee NR common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Employee NR common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return (rows || []).map((r) => {
    const idKey = Object.keys(r).find((k) => EMP_ID_KEY.test(k));
    const empId = idKey != null ? parseInt(String(r[idKey]).replace(/\D/g, ''), 10) : null;
    const monthlyRevenue = {};
    for (const [k, v] of Object.entries(r)) {
      if (MONTH_KEY.test(k)) monthlyRevenue[k] = String(v ?? '0').replace(/,/g, '');
    }
    return { empId: Number.isFinite(empId) ? empId : null, name: r.CCE, manager: r.Manager, monthlyRevenue };
  });
}
