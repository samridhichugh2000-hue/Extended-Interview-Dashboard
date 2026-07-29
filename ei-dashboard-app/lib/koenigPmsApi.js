const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Separate credentials/role (PMS) from the other Koenig integrations, so
// cache the token under its own module-level variable.
let tokenCache = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_PMS_API_USERNAME,
      userPassword: process.env.KOENIG_PMS_API_PASSWORD,
      userRole: process.env.KOENIG_PMS_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig PMS GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig PMS GetToken error: ${json.message}`);
  return { accessToken: json.content.accessToken, deviceToken: json.content.deviceToken };
}

async function getToken({ forceRefresh = false } = {}) {
  if (!tokenCache || forceRefresh) tokenCache = await fetchToken();
  return tokenCache;
}

// Net revenue per CCE (Sales), keyed by EmpId, with a MonthlyRevenue map like
// { "Jul-2026": "1331464.00", "Jun-2026": "0.00", ... }.
export async function getCCENRData(startDate, endDate) {
  const call = async (token) => {
    const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetCCENRData`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: { accessToken: token.accessToken, deviceToken: token.deviceToken }, startDate, endDate }),
    });
    if (!res.ok) throw new Error(`Koenig GetCCENRData failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig GetCCENRData error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return rows.map((r) => ({
    empId: r.EmpId,
    name: r.CCE,
    doj: r.DOJ,
    monthlyRevenue: r.MonthlyRevenue || {},
  }));
}
