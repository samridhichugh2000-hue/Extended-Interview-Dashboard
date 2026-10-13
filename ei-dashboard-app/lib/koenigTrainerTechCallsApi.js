const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Separate credentials/role from the other Koenig integrations, so cache the
// token under its own module-level variable.
let tokenCache = null;
let tokenPromise = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_TRAINERTECHCALL_API_USERNAME,
      userPassword: process.env.KOENIG_TRAINERTECHCALL_API_PASSWORD,
      userRole: process.env.KOENIG_TRAINERTECHCALL_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Trainer Tech Calls GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Trainer Tech Calls GetToken error: ${json.message}`);
  return { accessToken: json.content.accessToken, deviceToken: json.content.deviceToken };
}

// GetToken invalidates any previously issued token for these credentials, so
// concurrent callers share one in-flight fetch.
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

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// "13 Oct 2026" -> "2026-10-13"
function isoDate(v) {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})$/.exec(String(v || '').trim());
  if (!m) return null;
  const mi = MON.indexOf(m[2].toLowerCase());
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// Trainer Tech Calls by EmpCode — one row per tech call for the date range.
// StartDate/EndDate (YYYY-MM-DD) are required: blank dates return nothing.
// The EmpCode filter is NOT applied by the API (any value returns every
// trainer), so we request all trainers in one call and group by each row's own
// "Emp Code". The per-row "Converted Tech Calls"/"Total Tech Calls" fields are
// grand totals across all trainers, so they are ignored — count rows instead.
// Returns [{ empCode, callId, name, date, client, converted }].
export async function getTrainerTechCalls(startDate, endDate) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_TRAINERTECHCALL_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmpCode: '', StartDate: startDate, EndDate: endDate }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Koenig Trainer Tech Calls common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);
  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Trainer Tech Calls common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return (rows || []).map((r) => ({
    empCode: String(r['Emp Code']),
    callId: r['Tech Call Id'],
    name: r['Tech Call Name'] || null,
    date: isoDate(r['Tech Call Date']),
    client: r['Client'] || null,
    converted: r['Converted'] === 'Yes',
  }));
}
