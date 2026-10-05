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
      userName: process.env.KOENIG_SALARY_API_USERNAME,
      userPassword: process.env.KOENIG_SALARY_API_PASSWORD,
      userRole: process.env.KOENIG_SALARY_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Employee Salary GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Employee Salary GetToken error: ${json.message}`);
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

// Employee Salary Details — per-employee (EmpId). Replaces the Net Payable feed
// as the PA Algo's salary source: Salary equals the old PayScale (fixed
// monthly pay scale) for every employee checked, without the same-calendar-
// month date juggling. Returns one row {EmpId, Name, Department, DOJ, Salary,
// SalarySource}; Salary is null when no figure is on file. A blank EmpId
// returns an empty list.
export async function getEmployeeSalary(empCode) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_SALARY_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmpId: String(empCode) }),
    });
    if (!res.ok) throw new Error(`Koenig Employee Salary common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Employee Salary common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  const row = rows && rows[0];
  if (!row || row.Message) return null;
  const salary = row.Salary != null && row.Salary !== '' ? Number(row.Salary) : null;
  return { salary: Number.isFinite(salary) ? salary : null, salarySource: row.SalarySource || null };
}
