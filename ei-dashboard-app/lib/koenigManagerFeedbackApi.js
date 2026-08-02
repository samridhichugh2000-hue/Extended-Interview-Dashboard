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
      userName: process.env.KOENIG_MGRFEEDBACK_API_USERNAME,
      userPassword: process.env.KOENIG_MGRFEEDBACK_API_PASSWORD,
      userRole: process.env.KOENIG_MGRFEEDBACK_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Manager Feedback GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Manager Feedback GetToken error: ${json.message}`);
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

// Manager feedback — bulk, org-wide (every employee who has a manager, not
// just Sales/Trainer/PT Team), like PIP/assignments/SC. ReporteeEmpID is the
// numeric employee code directly on the row, same as trainer assignments —
// no name/email fuzzy matching needed, unlike the enquiry audit feed. Common
// across every department, so this feed is joined against the full roster
// rather than one team.
export async function getManagerFeedback(startDate, endDate) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_MGRFEEDBACK_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Startdate: startDate, Enddate: endDate, EmployeeName: '' }),
    });
    if (!res.ok) throw new Error(`Koenig Manager Feedback common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Manager Feedback common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return (rows || [])
    .filter((r) => r.ReporteeEmpID)
    .map((r) => ({
      empCode: r.ReporteeEmpID,
      reporteeName: r.DirectReporteeName,
      managerEmpCode: r.ManagerEmpID,
      managerName: r.ManagerName,
      strength: r.AreaOfStrength || '',
      improvement: r.AreaOfImprovement || '',
      other: r.OtherFeedback || '',
      date: r.DateOfFb,
    }));
}
