const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Separate credentials/role (Get Target Achieved Details) from the other
// Koenig integrations, so cache the token under its own module-level
// variable.
let tokenCache = null;
let tokenPromise = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_TARGET_API_USERNAME,
      userPassword: process.env.KOENIG_TARGET_API_PASSWORD,
      userRole: process.env.KOENIG_TARGET_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Target GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Target GetToken error: ${json.message}`);
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

// Quarter Target Achievement — no per-employee "get one" call, everyone
// comes back in one list (like getCCENRData), keyed by EmpId. Called with
// empty Quarter/Year/Team (matching Koenig's own documented example) so the
// full available history comes back in one shot rather than requiring us to
// already know their fiscal-quarter naming convention; syncTargetAchievement
// (lib/syncRunners.js) then picks the most recent quarter per employee off
// this list rather than trusting the API to know what "current" means.
export async function getTargetAchievement() {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_TARGET_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Quarter: '', Year: '', Team: '' }),
    });
    if (!res.ok) throw new Error(`Koenig Target common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Target common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return (rows || [])
    .filter((r) => r.EmpId != null)
    .map((r) => ({
      empId: r.EmpId,
      name: r.Employee,
      quarterName: r.QuarterName,
      quarterYear: r.QuarterYear,
      team: r.Team,
      achievedPct: r.Achieved_Percentage,
      remarks: r.Remarks,
    }));
}
