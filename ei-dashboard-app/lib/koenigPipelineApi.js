const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Separate credentials/role (Sales Pipeline) from the other Koenig
// integrations, so cache the token under its own module-level variable.
let tokenCache = null;
let tokenPromise = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_PIPELINE_API_USERNAME,
      userPassword: process.env.KOENIG_PIPELINE_API_PASSWORD,
      userRole: process.env.KOENIG_PIPELINE_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Pipeline GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Pipeline GetToken error: ${json.message}`);
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

// Sales Pipeline — per-CSM only (no bulk mode), matched by email against
// their login/official/alias mailbox. Always returns 7 rows on a real match:
// the current month plus the next 5, then a final "No date" row for deals
// with no training month attached yet (sentinel monDate "1900-01-01" — must
// not be sorted/charted with the real months). An email matching no CSM
// isn't an HTTP error — it's a 200 with a single {status: 'CSM_NOT_FOUND'}
// row, so status is checked before trusting any row.
//
// ~3s per call and explicitly "not built to be hammered in a tight loop
// across every CSM at once" — syncPipeline (lib/syncRunners.js) calls this
// strictly sequentially, one CSM at a time, never concurrently.
export async function getSalesPipeline(csmEmail) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_PIPELINE_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ CsmEmail: csmEmail }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Koenig Pipeline common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Pipeline common API error: ${json.message}`);
  }

  if (!json.content) throw new Error('Koenig Pipeline common API returned empty content — check apikey is correct and active');

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  if (!rows?.length || rows[0].status === 'CSM_NOT_FOUND') return { status: 'CSM_NOT_FOUND' };

  const months = rows.filter((r) => r.mon !== 'No date').map((r) => ({ mon: r.mon, monDate: r.monDate, expectedNR: r.expectedNR, deals: r.deals }));
  const undatedRow = rows.find((r) => r.mon === 'No date');
  const undated = undatedRow ? { expectedNR: undatedRow.expectedNR, deals: undatedRow.deals } : { expectedNR: 0, deals: 0 };
  const totalNR = rows.reduce((sum, r) => sum + (r.expectedNR || 0), 0);
  const totalDeals = rows.reduce((sum, r) => sum + (r.deals || 0), 0);

  return {
    status: 'OK',
    csmUserId: rows[0].csmUserId,
    csmName: rows[0].csmName,
    months,
    undated,
    totalNR,
    totalDeals,
  };
}
