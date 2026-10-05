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
      userName: process.env.KOENIG_UTILSC_API_USERNAME,
      userPassword: process.env.KOENIG_UTILSC_API_PASSWORD,
      userRole: process.env.KOENIG_UTILSC_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Utilization SC/NonSC GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Utilization SC/NonSC GetToken error: ${json.message}`);
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

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Trainer Utilization Hours SC / NonSC — per trainer, per month. `monthYear`
// must be a month name + year ("September 2026" or "Sep 2026"); numeric forms
// ("2026-09", "09-2026") 500 with an nvarchar-to-date error. The request's
// mode/from_date/to_date fields are left blank: with monthYear set the month
// wins, and no mode value found so far makes a from_date/to_date range work.
// A trainer/month with nothing on file comes back as a normal 200 with zeros
// (EmpCode/Employee Name null), so zeros here mean "no hours", not "no
// record". Returns { scHours, nonScHours, totalHours }.
export async function getMonthlyScHours(empCode, year, monthIndex) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_UTILSC_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    // Timeout: this feed makes thousands of calls per sync, and a single
    // dropped connection with no timeout would hang the whole run.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empcode: String(empCode), monthYear: `${MONTH_NAMES[monthIndex]} ${year}`, mode: '', from_date: '', to_date: '' }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Koenig Utilization SC/NonSC common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  // Koenig's backend is slow per call (~1.5s) and answers "Execution Timeout
  // Expired" (a 500) when hit with too many at once — retried with a short
  // backoff. A token refresh is only for auth failures ("Forbidden"):
  // GetToken invalidates every other in-flight caller's token, so refreshing
  // on a timeout would knock out the whole concurrent batch.
  let token = await getToken();
  let json;
  for (let attempt = 1; ; attempt++) {
    try {
      json = await call(token);
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    if (json.statuscode === 200) break;
    const msg = String(json.message || '');
    if (/forbidden|permission|unauthori[sz]ed|token/i.test(msg) && attempt < 3) {
      token = await getToken({ forceRefresh: true });
      continue;
    }
    if (/timeout|not responding|deadlock/i.test(msg) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    throw new Error(`Koenig Utilization SC/NonSC common API error: ${msg}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  const row = rows && rows[0];
  if (!row) return { scHours: 0, nonScHours: 0, totalHours: 0 };
  return {
    scHours: Number(row.SCHours) || 0,
    nonScHours: Number(row.NonSCHours) || 0,
    totalHours: Number(row.TotalHours) || 0,
  };
}
