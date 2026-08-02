const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Separate credentials/role from the New Joiners API, so cache the token
// under its own module-level variable.
let tokenCache = null;
let tokenPromise = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_PIP_API_USERNAME,
      userPassword: process.env.KOENIG_PIP_API_PASSWORD,
      userRole: process.env.KOENIG_PIP_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig PIP GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig PIP GetToken error: ${json.message}`);
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

// The `EmpCode` request field doesn't filter by that employee — it scopes
// visibility (likely by org hierarchy). 2847 is the value used in Koenig's
// own API doc example and empirically returns the full PIP/PA dataset, so
// it's used here as the "give me everything" scope code.
const FULL_ACCESS_EMP_CODE = 2847;

// Type: 8 is fixed per the API contract (PIP/PA incident category). Each
// returned row's own `Type` field distinguishes "PIP" vs "Performance Alert".
export async function getPipPanelData(from, to) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_PIP_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmpCode: FULL_ACCESS_EMP_CODE, From: from, To: to, Type: 8 }),
    });
    if (!res.ok) throw new Error(`Koenig PIP common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig PIP common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return rows.map((r) => ({
    sourceId: r.Id,
    empCode: r.Empcode,
    name: r.Name,
    manager: r.Manager,
    fromDate: r.FromDate,
    toDate: r.ToDate,
    createdOn: r.CreatedOn,
    isActive: !!r.isActive,
    comment: r.comment,
    resigned: !!r.Resigned,
    type: r.Type === 'PIP' ? 'PIP' : 'PA',
    initiatedBy: r.InitaitedBy,
    resignationDate: r.ResignationDate || null,
  }));
}
