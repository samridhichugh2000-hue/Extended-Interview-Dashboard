const BASE_URL = process.env.KOENIG_API_BASE_URL;

// "GetLastTwoAppraisals" — per-employee (numeric EmpId only: "EMP2388" is a
// 500, a blank EmpId returns one arbitrary employee's rows). Separate
// credentials from the other Koenig integrations, so its token is cached on
// its own.
let tokenCache = null;
let tokenPromise = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_APPRAISAL_API_USERNAME,
      userPassword: process.env.KOENIG_APPRAISAL_API_PASSWORD,
      userRole: process.env.KOENIG_APPRAISAL_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Appraisal GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Appraisal GetToken error: ${json.message}`);
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

const dateOnly = (v) => (v ? String(v).slice(0, 10) : null);

// Returns the employee's last two appraisals, newest first:
// [{ appraisalDate: 'YYYY-MM-DD', nextAppraisalDate: 'YYYY-MM-DD' | null }].
// The Salary field is encrypted by Koenig (no key on our side), so it is not
// read. An employee with no appraisal on file returns [].
export async function getAppraisals(empCode) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_APPRAISAL_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmpId: String(empCode) }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Koenig Appraisal common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let json;
  for (let attempt = 1; ; attempt++) {
    const token = await getToken({ forceRefresh: attempt > 1 });
    json = await call(token);
    if (json.statuscode === 200) break;
    if (attempt >= 3) throw new Error(`Koenig Appraisal common API error: ${json.message}`);
    await new Promise((r) => setTimeout(r, 500 * attempt + Math.random() * 1000));
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return (rows || [])
    .filter((r) => r.AppraisalDate)
    .map((r) => ({ appraisalDate: dateOnly(r.AppraisalDate), nextAppraisalDate: dateOnly(r.NextAppraisalDate) }))
    .sort((a, b) => b.appraisalDate.localeCompare(a.appraisalDate));
}
