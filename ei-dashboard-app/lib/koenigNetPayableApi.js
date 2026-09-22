const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Separate credentials/role from the other Koenig integrations, same pattern
// as lib/koenigTechCallApi.js — cache the token under its own module-level
// variable.
let tokenCache = null;
let tokenPromise = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_NETPAYABLE_API_USERNAME,
      userPassword: process.env.KOENIG_NETPAYABLE_API_PASSWORD,
      userRole: process.env.KOENIG_NETPAYABLE_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Net Payable GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Net Payable GetToken error: ${json.message}`);
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

// Get Net Payable Details for a single EmpCode — undocumented but confirmed
// live: StartDate/EndDate must be YYYY-MM-DD and fall within the SAME
// calendar month (the API returns one payroll month per call; a range
// spanning two months 500s with "StartDate and EndDate must fall within the
// same calendar month"). Returns the raw row (Leave_BF, Payable_Days,
// PayScale, PF, TDS, Salary, ...) for that month, or null if nothing's been
// run for that employee/month yet.
export async function getNetPayable(empCode, monthStartIso, monthEndIso) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_NETPAYABLE_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmpCode: String(empCode), StartDate: monthStartIso, EndDate: monthEndIso }),
    });
    if (!res.ok) throw new Error(`Koenig Net Payable common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Net Payable common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  if (!rows || !rows.length) return null;
  return rows[0];
}
