const BASE_URL = process.env.KOENIG_API_BASE_URL;

// "Get Incident Data By EmpID" — HR-logged incidents per employee, including the Negative Enquiry Audits raised by
// hand (reportee feedback, unreplied-email reviews) that the Enquiry Audit Report feed does not carry. EmpCode is
// required: an empty one returns an unattributed dump (EmpCode 0, no names).
let tokenCache = null;
let tokenPromise = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_INCIDENT_API_USERNAME,
      userPassword: process.env.KOENIG_INCIDENT_API_PASSWORD,
      userRole: process.env.KOENIG_INCIDENT_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Incident GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Incident GetToken error: ${json.message}`);
  return { accessToken: json.content.accessToken, deviceToken: json.content.deviceToken };
}

// GetToken invalidates the previously issued token for these credentials, so concurrent callers share one fetch.
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

async function getIncidents(empCode) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_INCIDENT_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmpCode: String(empCode) }),
    });
    if (!res.ok) throw new Error(`Koenig Incident common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let json = await call(await getToken());
  if (json.statuscode !== 200) {
    json = await call(await getToken({ forceRefresh: true }));
    if (json.statuscode !== 200) throw new Error(`Koenig Incident common API error: ${json.message}`);
  }
  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return Array.isArray(rows) ? rows : [];
}

// An employee's Negative Enquiry Audit incidents, in the same shape the dashboard stores audit remarks in.
// ErrorId is the incident type code (the same for every audit), not an enquiry id, so enquiryId stays null.
export async function getNegativeEnquiryAudits(empCode) {
  const rows = await getIncidents(empCode);
  return rows
    .filter((r) => String(r.IncidentType || '').trim() === 'Negative Enquiry Audit' && String(r.IncidentNature || '').trim() === 'Negative')
    .map((r) => ({
      createdOn: r.ReportedDate,
      rating: 'below_satisfactory',
      remark: r.Reason,
      enquiryId: null,
      clientEmail: null,
      source: 'incident',
    }));
}
