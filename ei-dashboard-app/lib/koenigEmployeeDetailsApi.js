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
      userName: process.env.KOENIG_EMPDETAILS_API_USERNAME,
      userPassword: process.env.KOENIG_EMPDETAILS_API_PASSWORD,
      userRole: process.env.KOENIG_EMPDETAILS_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Employee Details GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Employee Details GetToken error: ${json.message}`);
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

// "Get Employee Details (PMS)" for a single emp_code — per-employee only,
// same shape as Net Payable / Common Index. Only country/location and role
// fields are pulled out — the raw response also carries bank account, IFSC,
// UAN, personal phone and home address, none of which this dashboard has
// any use for, so they're deliberately left out rather than stored.
export async function getEmployeeDetails(empCode) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_EMPDETAILS_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emp_code: String(empCode) }),
    });
    if (!res.ok) throw new Error(`Koenig Employee Details common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Employee Details common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  const r = rows?.[0];
  if (!r || !r.country_name) return null;
  return {
    countryName: r.country_name,
    cityName: r.city_name || null,
    stateName: r.state_name || null,
    isOverseas: r.Is_oversease === 'true' || r.Is_oversease === true,
    departmentName: r.deparment_name || null,
    designationName: r.designation_name || null,
  };
}
