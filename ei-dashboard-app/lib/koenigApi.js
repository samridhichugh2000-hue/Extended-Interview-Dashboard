const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Access/device tokens aren't documented with an expiry — cache in memory per
// server process and re-fetch on the first 401/error rather than on a timer.
let tokenCache = null;
let tokenPromise = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_API_USERNAME,
      userPassword: process.env.KOENIG_API_PASSWORD,
      userRole: process.env.KOENIG_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig GetToken error: ${json.message}`);
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

// Fetches new joiners between `from` and `to` (YYYY-MM-DD). One retry with a
// fresh token if the cached one has gone stale.
export async function getNewJoiners(from, to) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ From: from, To: to }),
    });
    if (!res.ok) throw new Error(`Koenig common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig common API error: ${json.message}`);
  }

  const rows = JSON.parse(json.content);
  return rows.map((r) => ({
    empId: r.EmpID,
    name: r['Employee Name'],
    email: r.Email,
    joiningDate: r['Joining Date'],
    managerName: r['Manager Name'],
    department: r['Department'],
    section: classifySection(r['Department']),
    active: isActive(r.DOR, r.LWD),
  }));
}

// Koenig has no explicit status field. An EmpID that hasn't exited comes back
// with the sentinel date 1900-01-01 for both DOR (date of resignation) and
// LWD (last working day); any real date in either means they've left.
const SENTINEL_DATE = '1900-01-01';
function isActive(dor, lwd) {
  const exited = (v) => v && !String(v).startsWith(SENTINEL_DATE);
  return !exited(dor) && !exited(lwd);
}

// Bifurcates the raw Koenig "Department" value into the dashboard's three
// sections. "Blue Collared" is excluded entirely — it isn't tracked here.
export function classifySection(department) {
  if (department === 'Blue Collared') return null;
  if (department === 'Sales') return 'Sales';
  if (department === 'Training Delivery Inhouse') return 'Trainer';
  return 'PT Team';
}
