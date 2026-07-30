const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Separate credentials/role from the other Koenig integrations, so cache the
// token under its own module-level variable.
let tokenCache = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_TBT_API_USERNAME,
      userPassword: process.env.KOENIG_TBT_API_PASSWORD,
      userRole: process.env.KOENIG_TBT_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig TBT GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig TBT GetToken error: ${json.message}`);
  return { accessToken: json.content.accessToken, deviceToken: json.content.deviceToken };
}

async function getToken({ forceRefresh = false } = {}) {
  if (!tokenCache || forceRefresh) tokenCache = await fetchToken();
  return tokenCache;
}

// Get TBT RECORD — per-employee, like exam summary/skills. Matched directly
// by EmpCode. No date-range filtering needed on our end: an empty array
// (not a "no match" placeholder row) means genuinely zero TBTs.
export async function getTbtRecords(empCode) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_TBT_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmpCode: String(empCode) }),
    });
    if (!res.ok) throw new Error(`Koenig TBT common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig TBT common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return (rows || [])
    .filter((r) => r.EmpCode)
    .map((r) => ({
      topic: r.TOPIC,
      requestedOn: r.TBTREQUESTED,
      tbtDate: r.TBTDATE,
    }));
}
