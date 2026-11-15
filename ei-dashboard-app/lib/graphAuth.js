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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isGet = (options) => !options.method || String(options.method).toUpperCase() === 'GET';

export async function graphFetch(url, options = {}) {
  // Transient failures are retried here for every caller: a thrown network error ("fetch failed" /
  // connect timeout — the local sync box's connection drops now and then) and Graph's own 502/503/504.
  // Reads are retried on both; a non-GET (e.g. sendMail) is only retried when the request never went
  // out (thrown error), because a 5xx on a POST may mean the mail was accepted — sendMail handles that itself.
  const rawCall = async (token) => {
    const get = isGet(options);
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token.accessToken}` } });
        if (get && [502, 503, 504].includes(r.status) && attempt < 3) { await sleep(1500 * 2 ** attempt); continue; }
        return r;
      } catch (err) {
        if (attempt >= 3) throw err;
        await sleep(1500 * 2 ** attempt);
      }
    }
  };
  const call = rawCall;

  let token = await getGraphToken();
  let res = await call(token);
  if (res.status === 401) {
    token = await getGraphToken({ forceRefresh: true });
    res = await call(token);
  }
  // Graph throttles under sustained load (seen in practice: a full meetings
  // sync firing hundreds of attendance-report calls back-to-back stalled
  // out entirely, every remaining call also hitting 429). Honor Retry-After
  // and retry once, centrally, rather than every caller needing its own
  // backoff or the whole run failing the same way for the rest of its list.
  if (res.status === 429) {
    const retryAfterSec = parseInt(res.headers.get('Retry-After'), 10);
    const waitMs = Math.min(Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 5000, 30000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    res = await call(token);
  }
  return res;
}
