const BASE_URL = process.env.KOENIG_API_BASE_URL;

// "True NR" (net revenue after salary and marketing cost), shown on the
// dashboard next to the newer "NR (before salary and marketing cost)" feed in
// koenigNrApi.js. Source: GetCCENRData (role "PMS") — one call returns every
// employee's MonthlyRevenue for every month in the requested date range.
// Separate credentials from the other NR feeds, so its token is cached on its
// own.
let tokenCache = null;
let tokenPromise = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_TRUENR_API_USERNAME,
      userPassword: process.env.KOENIG_TRUENR_API_PASSWORD,
      userRole: process.env.KOENIG_TRUENR_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig True NR GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig True NR GetToken error: ${json.message}`);
  return { accessToken: json.content.accessToken, deviceToken: json.content.deviceToken };
}

// GetToken invalidates any previously issued token for these credentials —
// share one in-flight fetch between concurrent callers (see koenigApi.js).
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

// startDate/endDate (YYYY-MM-DD) are required — blank is a 400. The token
// goes in the request body, not the URL. Months outside the range are not
// returned; a future endDate returns future months too, so callers pass the
// end of the current month. Returns
// [{ empId: 4893, name, doj: 'YYYY-MM-DD', monthlyRevenue: { 'Oct-2026': 97959 } }].
export async function getTrueNrAll(startDate, endDate) {
  let json;
  for (let attempt = 1; ; attempt++) {
    const token = await getToken({ forceRefresh: attempt > 1 });
    const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetCCENRData`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, startDate, endDate }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok && res.status !== 400 && attempt < 3) { await new Promise((r) => setTimeout(r, 500 * attempt)); continue; }
    json = await res.json();
    if (json.statuscode === 200) break;
    if (attempt >= 3) throw new Error(`Koenig True NR GetCCENRData error: ${json.statuscode} ${json.message}`);
    await new Promise((r) => setTimeout(r, 500 * attempt + Math.random() * 1000));
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return (rows || []).map((r) => {
    const monthlyRevenue = {};
    for (const [k, v] of Object.entries(r.MonthlyRevenue || {})) {
      const n = Number(String(v ?? '0').replace(/,/g, ''));
      if (Number.isFinite(n)) monthlyRevenue[k] = n;
    }
    const empId = parseInt(String(r.EmpId).replace(/\D/g, ''), 10);
    return { empId: Number.isFinite(empId) ? empId : null, name: r.CCE, doj: r.DOJ || null, monthlyRevenue };
  });
}
