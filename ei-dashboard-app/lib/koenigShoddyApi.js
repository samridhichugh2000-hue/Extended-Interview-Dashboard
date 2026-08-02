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
      userName: process.env.KOENIG_SHODDY_API_USERNAME,
      userPassword: process.env.KOENIG_SHODDY_API_PASSWORD,
      userRole: process.env.KOENIG_SHODDY_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Shoddy GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Shoddy GetToken error: ${json.message}`);
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

// Get Incident Data By EmpID — per-employee. IncidentType/IncidentNature
// distinguish negative shoddy incidents from positive ones; we split the
// raw rows into two buckets so the UI can show them separately.
export async function getShoddyRecords(empCode) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_SHODDY_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmpCode: String(empCode) }),
    });
    if (!res.ok) throw new Error(`Koenig Shoddy common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Shoddy common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  const records = (rows || [])
    .filter((r) => r.EmpCode)
    .map((r) => ({
      name: r.Name,
      reportedDate: r.ReportedDate,
      repMngr: r.RepMngr,
      reason: r.Reason,
      errorId: r.ErrorId,
      incidentType: r.IncidentType,
      incidentNature: r.IncidentNature,
    }));

  const negative = records.filter((r) => /neg/i.test(r.incidentNature || ''));
  const positive = records.filter((r) => /pos/i.test(r.incidentNature || ''));
  return { negative, positive };
}
