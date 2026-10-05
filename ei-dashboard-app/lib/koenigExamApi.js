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

// Trainer Exam Details (with dates) — per-employee, one row per exam. An
// unknown EmpCode comes back as statuscode 500 "Trainer record not found" / "Employee not active"
// (not an HTTP error), treated as "no record" rather than thrown; a trainer
// that exists but has taken no exams gets a normal 200 with an empty list.
// Counts (total/pass/fail/not-updated) are derived from the rows' Result.
export async function getExamDetails(empCode) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_EXAM_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmpCode: String(empCode) }),
    });
    if (!res.ok) throw new Error(`Koenig Exam Details common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200 && !/not (found|active)/i.test(json.message || '')) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
  }
  if (json.statuscode !== 200) {
    if (/not (found|active)/i.test(json.message || '')) return null;
    throw new Error(`Koenig Exam Details common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  const exams = (rows || [])
    .map((r) => ({
      examId: r.ExamId,
      certificationId: r.CertificationId,
      examName: (r.ExamName || '').trim(),
      result: r.Result || null,
      scheduledOn: r.ExamScheduleDate || null,
      createdOn: r.CreatedOn || null,
      resultUpdatedOn: r.ResultUpdatedOn || null,
    }))
    .sort((a, b) => String(b.createdOn || '').localeCompare(String(a.createdOn || '')));

  const count = (result) => exams.filter((e) => e.result === result).length;
  return {
    totalExam: exams.length,
    passCount: count('Pass'),
    failCount: count('Fail'),
    statusNotUpdated: count('Not Updated'),
    exams,
  };
}
