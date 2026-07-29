const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Separate credentials/role from the other Koenig integrations, so cache the
// token under its own module-level variable.
let tokenCache = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_UTIL_API_USERNAME,
      userPassword: process.env.KOENIG_UTIL_API_PASSWORD,
      userRole: process.env.KOENIG_UTIL_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Utilization GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Utilization GetToken error: ${json.message}`);
  return { accessToken: json.content.accessToken, deviceToken: json.content.deviceToken };
}

async function getToken({ forceRefresh = false } = {}) {
  if (!tokenCache || forceRefresh) tokenCache = await fetchToken();
  return tokenCache;
}

// Month-wise Utilization. Unlike the other feeds, this one is per-employee —
// there's no "get everyone" call, so callers loop over their own employee
// list and call this once per empId. Rows come back keyed like
// "Jul 2026 Total Hour (Avg)": "43 ( 80)" — hours worked and a utilization
// figure in parens, one key per recent month (~14 months of history).
export async function getMonthlyUtilization(empId) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_UTIL_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empId: String(empId), Name: '' }),
    });
    if (!res.ok) throw new Error(`Koenig Utilization common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Utilization common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  if (!rows || !rows.length) return null;

  const row = rows[0];
  const months = {};
  for (const [key, val] of Object.entries(row)) {
    const m = key.match(/^([A-Za-z]{3} \d{4}) Total Hour \(Avg\)$/);
    if (!m) continue;
    const parts = String(val).match(/^([\d.]+)\s*\(\s*([\d.]+)\s*\)$/);
    months[m[1]] = parts ? { hours: parseFloat(parts[1]), util: parseFloat(parts[2]) } : { hours: null, util: null };
  }
  return { label: row.Trainer, months };
}
