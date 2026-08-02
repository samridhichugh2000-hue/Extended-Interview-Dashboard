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
      userName: process.env.KOENIG_SC_API_USERNAME,
      userPassword: process.env.KOENIG_SC_API_PASSWORD,
      userRole: process.env.KOENIG_SC_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig SC List GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig SC List GetToken error: ${json.message}`);
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

// List CSM SC List — every SC (service contract) raised, with the raising
// CSM's employee code directly on the row (no name-fuzzy-matching needed,
// unlike the enquiry audit feed).
export async function getScList(startDate, endDate) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_SC_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Startdate: startDate, Enddate: endDate }),
    });
    if (!res.ok) throw new Error(`Koenig SC List common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig SC List common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return rows
    .filter((r) => r.sc_created_by_csm_emp_code)
    .map((r) => ({
      scId: r.sc_id,
      createdOn: r.sc_created_date_time,
      empCode: r.sc_created_by_csm_emp_code,
      csmName: r.sc_created_by_csm_name,
      status: r.sc_status,
      quotationStatus: r.quotation_status,
    }));
}
