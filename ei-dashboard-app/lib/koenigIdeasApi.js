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
      userName: process.env.KOENIG_IDEAS_API_USERNAME,
      userPassword: process.env.KOENIG_IDEAS_API_PASSWORD,
      userRole: process.env.KOENIG_IDEAS_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Ideas GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Ideas GetToken error: ${json.message}`);
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

// Get Non-RMS Tasks By EmpID — per-employee. Feeds the "Ideas for
// improvement" Worry Index signal: each task raised against this employee
// outside RMS (e.g. an improvement suggestion logged by their manager/HR)
// counts as one occurrence. Returns [] for a genuinely empty roster, same as
// a confirmed 0 elsewhere in this app.
export async function getNonRmsTasks(empId) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_IDEAS_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmpId: String(empId) }),
    });
    if (!res.ok) throw new Error(`Koenig Ideas common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Ideas common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return (rows || [])
    .filter((r) => r.AutoTaskID != null)
    .map((r) => ({
      autoTaskId: r.AutoTaskID,
      taskExecutorName: r.TaskExecutorName,
      raisedByEmpId: r.RaisedByEmpId,
      raisedByName: r.RaisedByName,
      sourceName: r.SourceName,
      taskStatus: r.TaskStatus,
      taskDescription: r.TaskDescription,
      createdByActualName: r.CreatedByActualName,
      createdDateTime: r.CreatedDateTime,
    }));
}
