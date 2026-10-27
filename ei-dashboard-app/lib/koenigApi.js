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

  // Every process (dashboard page, sync route, local sync scripts) fetches
  // its own token, and Koenig's GetToken invalidates the previous one — so two
  // running at once knock each other out with "Forbidden : Permission
  // denied". Retry with a fresh token and a jittered pause so one of them
  // gets through instead of the dashboard showing zero new joiners.
  let json;
  for (let attempt = 1; ; attempt++) {
    const token = await getToken({ forceRefresh: attempt > 1 });
    json = await call(token);
    if (json.statuscode === 200) break;
    if (attempt >= 4) throw new Error(`Koenig common API error: ${json.message}`);
    await new Promise((r) => setTimeout(r, 500 * attempt + Math.random() * 1500));
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
    // Resignation date and last working day (null when Koenig has none) — a resigned
    // employee stays on the dashboard, highlighted, until the last working day arrives.
    dor: realDate(r.DOR),
    lwd: realDate(r.LWD),
  }));
}

// Koenig has no explicit status field. An EmpID that hasn't exited comes back
// with the sentinel date 1900-01-01 for both DOR (date of resignation) and
// LWD (last working day). Only a last working day that has arrived means they've left.
const SENTINEL_DATE = '1900-01-01';
const realDate = (v) => (v && !String(v).startsWith(SENTINEL_DATE) ? String(v).slice(0, 10) : null);
// Someone who has only RESIGNED (DOR) is still active — data stays on the dashboard and they
// are highlighted. They drop off once their last working day (LWD) has arrived (today or
// earlier, IST). A DOR with no LWD recorded stays active until Koenig records one.
function isActive(dor, lwd) {
  const last = realDate(lwd);
  if (!last) return true;
  const todayIst = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  return last > todayIst;
}

// Bifurcates the raw Koenig "Department" value into the dashboard's three
// sections. "Blue Collared" is excluded entirely — it isn't tracked here.
export function classifySection(department) {
  if (department === 'Blue Collared') return null;
  if (department === 'Sales' || department === 'Sales and Operations') return 'Sales';
  if (department === 'Training Delivery Inhouse') return 'Trainer';
  if (department === 'FM') return 'FM Team';
  if (department === 'HR - Talent acquisition') return 'Recruitment Team';
  return 'PT Team';
}

// Interviews created by one recruiter between `from` and `to` (YYYY-MM-DD),
// apikey 468. Returns [{ date: 'YYYY-MM-DDTHH:mm:ss', interviewer }]. Same
// stale-token retry as getNewJoiners.
export async function getRecruiterInterviews(empCode, from, to) {
  let json;
  for (let attempt = 1; ; attempt++) {
    const token = await getToken({ forceRefresh: attempt > 1 });
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=468&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmpCode: Number(empCode), StartDate: from, EndDate: to }),
    });
    if (!res.ok) throw new Error(`Koenig recruiter interviews API failed: ${res.status} ${res.statusText}`);
    json = await res.json();
    if (json.statuscode === 200) break;
    if (attempt >= 4) throw new Error(`Koenig recruiter interviews API error: ${json.message}`);
    await new Promise((r) => setTimeout(r, 500 * attempt + Math.random() * 1500));
  }
  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : (json.content ?? []);
  return rows.map((r) => ({ date: r.Date, interviewer: r.Interviewers }));
}
