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
      userName: process.env.KOENIG_INHOUSE_API_USERNAME,
      userPassword: process.env.KOENIG_INHOUSE_API_PASSWORD,
      userRole: process.env.KOENIG_INHOUSE_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig In-House Skills GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig In-House Skills GetToken error: ${json.message}`);
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

// Get In-House Skills Marked by Employee — per-employee, like Trainer Skills.
// Distinct feed from koenigSkillsApi.js (different role/credentials/key and
// a different field shape): this one reports courses the trainer has marked
// as an in-house skill, with who marked it and who trained it, rather than
// duplicate/discontinued flags.
export async function getInHouseSkills(empCode) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_INHOUSE_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emp_code: String(empCode) }),
    });
    if (!res.ok) throw new Error(`Koenig In-House Skills common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig In-House Skills common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return (rows || [])
    .filter((r) => r.course_id)
    .map((r) => ({
      courseId: r.course_id,
      courseName: r.course_name,
      markedBy: r.in_house_skill_marked_by_user_name,
      trainerName: r.in_house_trainer_name,
      trainerActive: !!r.Is_house_trainer_still_active,
      markDate: r.in_house_mark_date,
    }));
}
