const TENANT_ID = process.env.GRAPH_TENANT_ID;
const CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const SENDER_EMAIL = process.env.GRAPH_SENDER_EMAIL;

// Unlike Koenig's undocumented tokens (cached with no expiry awareness),
// Graph client-credentials tokens carry a real `expires_in` (~60-90 min) —
// track it and refresh proactively rather than waiting for a 401.
let tokenCache = null; // { accessToken, expiresAt }
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

async function getGraphToken({ forceRefresh = false } = {}) {
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

// Sends as SENDER_EMAIL's mailbox via application permissions (Mail.Send).
// `to`/`cc` may be a single address or an array.
export async function sendMail({ to, cc, subject, html }) {
  const toList = (Array.isArray(to) ? to : [to]).map((address) => ({ emailAddress: { address } }));
  const ccList = cc ? (Array.isArray(cc) ? cc : [cc]).map((address) => ({ emailAddress: { address } })) : [];

  const call = async (token) => {
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER_EMAIL)}/sendMail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.accessToken}` },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: toList,
          ccRecipients: ccList,
        },
        saveToSentItems: true,
      }),
    });
    return res;
  };

  let token = await getGraphToken();
  let res = await call(token);

  if (res.status === 401) {
    token = await getGraphToken({ forceRefresh: true });
    res = await call(token);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph sendMail failed: ${res.status} ${text}`);
  }
}
