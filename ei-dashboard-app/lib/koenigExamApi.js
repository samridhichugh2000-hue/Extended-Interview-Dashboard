const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Separate credentials/role from the other Koenig integrations, so cache the
// token under its own module-level variable.
let tokenCache = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_EXAM_API_USERNAME,
      userPassword: process.env.KOENIG_EXAM_API_PASSWORD,
      userRole: process.env.KOENIG_EXAM_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Exam Summary GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Exam Summary GetToken error: ${json.message}`);
  return { accessToken: json.content.accessToken, deviceToken: json.content.deviceToken };
}

async function getToken({ forceRefresh = false } = {}) {
  if (!tokenCache || forceRefresh) tokenCache = await fetchToken();
  return tokenCache;
}

// Trainer Exam Summary — per-employee, like the utilization feed. A bad or
// blank EmpCode comes back as {Status: 0, Message: "Wrong EmpId"} rather
// than an HTTP error, so that's treated as "no record" rather than thrown.
export async function getExamSummary(empCode) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_EXAM_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmpCode: String(empCode) }),
    });
    if (!res.ok) throw new Error(`Koenig Exam Summary common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Exam Summary common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  const row = rows && rows[0];
  if (!row || row.Status !== 1) return null;

  return {
    totalExam: row.TotalExam ?? 0,
    passCount: row.PassCount ?? 0,
    failCount: row.FailCount ?? 0,
    statusNotUpdated: row.StatusNotUpdated ?? 0,
  };
}
