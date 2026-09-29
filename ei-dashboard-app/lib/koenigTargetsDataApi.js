const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Separate credentials/role (Get Targets Data) from the other Koenig
// integrations, so cache the token under its own module-level variable.
let tokenCache = null;
let tokenPromise = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_TARGETSDATA_API_USERNAME,
      userPassword: process.env.KOENIG_TARGETSDATA_API_PASSWORD,
      userRole: process.env.KOENIG_TARGETSDATA_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Targets Data GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Targets Data GetToken error: ${json.message}`);
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

// Get Targets Data — every quarterly target on file (2024 onward) for every
// ASM/CSM/DM/CM, in one list keyed by EmpId (bare numeric, no "EMP" prefix —
// same convention confirmed against the employees table as the Common Index
// API). Unlike Get Target Achieved Details (lib/koenigTargetApi.js, which
// has returned zero rows for every query tried), this one has real, current
// data — but it's the target figure itself, not an achievement percentage.
// syncTargetsData (lib/syncRunners.js) filters to this quarter's CSM rows
// and computes the achievement % itself from synced NR.
export async function getTargetsData() {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_TARGETSDATA_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`Koenig Targets Data common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Targets Data common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return (rows || [])
    .filter((r) => r.EmpId != null)
    .map((r) => ({
      empId: r.EmpId,
      name: r.Employee,
      targetName: r.Target_Name,
      targetYear: r.Target_Year,
      target: r.Target,
      type: r.Type,
    }));
}
