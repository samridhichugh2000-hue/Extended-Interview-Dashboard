const TENANT_ID = process.env.GRAPH_TENANT_ID;
const CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;

// Shared client-credentials token cache for every Graph caller (mail,
// calendar, online meetings, call records) — one token covers every scope
// granted to this app registration. Graph tokens carry a real `expires_in`
// (~60-90 min); refresh proactively rather than waiting for a 401.
let tokenCache = null;
let tokenPromise = null;

async function fetchToken() {
  const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Graph GetToken failed: ${res.status} ${json.error_description || json.error || res.statusText}`);
  return { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
}

export async function getGraphToken({ forceRefresh = false } = {}) {
  if (forceRefresh) { tokenCache = null; tokenPromise = null; }
  // Refresh a minute early rather than racing an exact-expiry 401.
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache;
  if (!tokenPromise) {
    tokenPromise = fetchToken()
      .then((t) => { tokenCache = t; return t; })
      .finally(() => { tokenPromise = null; });
  }
  return tokenPromise;
}

// Every Graph caller in this app follows the same shape: try with the cached
// token, force-refresh once and retry on a 401.
export async function graphFetch(url, options = {}) {
  const call = async (token) => fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token.accessToken}` } });

  let token = await getGraphToken();
  let res = await call(token);
  if (res.status === 401) {
    token = await getGraphToken({ forceRefresh: true });
    res = await call(token);
  }
  return res;
}
