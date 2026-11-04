// Pushes a PA/PIP issued from this dashboard into RMS (Koenig's system of record)
// through the "Insert PiP Records" role of the Kites Operator API.
//
// Separate credentials from the read-only PIP feed (lib/koenigPipApi.js) — this
// is its own Koenig user (KOENIG_PIP_INSERT_API_*), so its token is cached
// separately and never invalidates the read feed's token.
const BASE_URL = process.env.KOENIG_API_BASE_URL;

let tokenCache = null;
let tokenPromise = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_PIP_INSERT_API_USERNAME,
      userPassword: process.env.KOENIG_PIP_INSERT_API_PASSWORD,
      userRole: process.env.KOENIG_PIP_INSERT_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`RMS GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`RMS GetToken error: ${json.message}`);
  return { accessToken: json.content.accessToken, deviceToken: json.content.deviceToken };
}

// GetToken invalidates the previous token for these credentials, so concurrent
// callers share one in-flight fetch.
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

// Builds the Insert PiP Records request. Id/Eid stay empty (a new record, not an
// edit). EmpId is the Koenig employee code (dashboard ids are 'EMP' + code).
export function buildInsertPipRequest({ employeeId, pipType, issuedOn, deadline, comment }) {
  return {
    SearchText: '',
    Id: '',
    Eid: '',
    From: issuedOn,
    To: deadline,
    CreatedBy: process.env.KOENIG_PIP_INSERT_CREATED_BY || '',
    EmpId: String(employeeId).replace(/^EMP/i, ''),
    comment: String(comment || ''),
    status: '',
    resign: '',
    PerformanceAlertChecked: pipType === 'PA',
    PIPChecked: pipType === 'PIP',
    selectedInitiator: process.env.KOENIG_PIP_INSERT_INITIATOR || 'hr',
    EIChecked: '',
  };
}

// Returns the API's parsed response. Throws on any HTTP / statuscode failure so
// the caller can report that RMS was NOT updated. An expired token is refreshed
// and retried once. Note: a non-idempotent insert is only retried when the
// first attempt was rejected for its token (statuscode != 200 before any insert).
export async function insertPipRecord(request) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_PIP_INSERT_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`RMS insert failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let json = await call(await getToken());
  if (json.statuscode === 401 || json.statuscode === 403) {
    json = await call(await getToken({ forceRefresh: true }));
  }
  if (json.statuscode !== 200) throw new Error(`RMS insert error: ${json.message || json.statuscode}`);
  return json;
}
