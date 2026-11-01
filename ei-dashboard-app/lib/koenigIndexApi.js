const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Koenig's "Get <X> Index Score" feeds (CSM, TI, ASM, ...) share one shape: a
// GetToken call, then an empty-body POST to /common that returns every
// employee's current score as [{EmployeeName, ManagerName, EmpId, IndexScore,
// RefreshedOn}]. Each feed has its own credentials/role, so the token is cached
// per env-var prefix (KOENIG_<prefix>_API_USERNAME / _PASSWORD / _ROLE / _KEY).
const tokens = new Map(); // prefix -> { cache, promise }

async function fetchToken(prefix, label) {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env[`KOENIG_${prefix}_API_USERNAME`],
      userPassword: process.env[`KOENIG_${prefix}_API_PASSWORD`],
      userRole: process.env[`KOENIG_${prefix}_API_ROLE`],
    }),
  });
  if (!res.ok) throw new Error(`Koenig ${label} GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig ${label} GetToken error: ${json.message}`);
  return { accessToken: json.content.accessToken, deviceToken: json.content.deviceToken };
}

async function getToken(prefix, label, { forceRefresh = false } = {}) {
  if (!tokens.has(prefix)) tokens.set(prefix, { cache: null, promise: null });
  const t = tokens.get(prefix);
  if (forceRefresh) { t.cache = null; t.promise = null; }
  if (t.cache) return t.cache;
  if (!t.promise) {
    t.promise = fetchToken(prefix, label)
      .then((tok) => { t.cache = tok; return tok; })
      .finally(() => { t.promise = null; });
  }
  return t.promise;
}

// Takes no employee/date input (any extra input is ignored), so it is fetched
// once and indexed rather than called per employee. An empty array means the
// feed has no rows yet, not an error.
export async function getIndexScores(prefix, label) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env[`KOENIG_${prefix}_API_KEY`]}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`Koenig ${label} common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken(prefix, label);
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken(prefix, label, { forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig ${label} common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return rows || [];
}
