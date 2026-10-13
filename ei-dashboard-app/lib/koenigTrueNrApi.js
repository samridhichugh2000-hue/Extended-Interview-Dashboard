const BASE_URL = process.env.KOENIG_API_BASE_URL;

// "Get Employee NR" — the OLD NR API, shown on the dashboard as "True NR"
// (net revenue after salary and marketing cost), next to the newer "NR
// (before salary and marketing cost)" feed in koenigNrApi.js. Separate
// credentials, so its token is cached on its own.
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

// Per-employee, numeric EmpId only ("4893" — "EMP4893" is a 500; an empty
// EmpId returns nothing). Returns just the last ~3 calendar months as
// [{ month: 'Oct-2026', trueNr: -508428 }] — the caller accumulates them
// into a longer history over successive syncs (see syncTrueNr).
export async function getTrueNr(empCode) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_TRUENR_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmpId: String(empCode) }),
    });
    if (!res.ok) throw new Error(`Koenig True NR common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let json;
  for (let attempt = 1; ; attempt++) {
    const token = await getToken({ forceRefresh: attempt > 1 });
    json = await call(token);
    if (json.statuscode === 200) break;
    if (attempt >= 3) throw new Error(`Koenig True NR common API error: ${json.message}`);
    await new Promise((r) => setTimeout(r, 500 * attempt + Math.random() * 1000));
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return (rows || [])
    .filter((r) => r.month && r.TotalNR != null && Number.isFinite(Number(r.TotalNR)))
    .map((r) => ({ month: r.month, trueNr: Number(r.TotalNR) }));
}
