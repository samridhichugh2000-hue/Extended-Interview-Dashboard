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
      userName: process.env.KOENIG_NEGFB_API_USERNAME,
      userPassword: process.env.KOENIG_NEGFB_API_PASSWORD,
      userRole: process.env.KOENIG_NEGFB_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Trainer Negative Feedback GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Trainer Negative Feedback GetToken error: ${json.message}`);
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

// Get Trainer Negative Feedback — per-employee, matched directly by
// employee_id. Each row IS one negative-feedback incident (the feed only
// returns negative ones), so the count is simply rows.length.
export async function getTrainerNegativeFeedback(empCode) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_NEGFB_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: String(empCode) }),
    });
    if (!res.ok) throw new Error(`Koenig Trainer Negative Feedback common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Trainer Negative Feedback common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return (rows || [])
    .filter((r) => r.assignment_id)
    .map((r) => ({
      assignmentId: r.assignment_id,
      feedbackDate: r.feedback_date,
      clientName: r.client_name,
      csmName: r.csm_name,
      question: r.feedback_question,
      answer: r.feedback_answer,
      assignmentStart: r.assignment_start_date,
      assignmentEnd: r.assignment_end_date,
      deliveryMode: r.assignment_delivery_mode,
    }));
}
