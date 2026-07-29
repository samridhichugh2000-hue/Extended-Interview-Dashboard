const BASE_URL = process.env.KOENIG_API_BASE_URL;

// Separate credentials/role from the other Koenig integrations, so cache the
// token under its own module-level variable.
let tokenCache = null;

async function fetchToken() {
  const res = await fetch(`${BASE_URL}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: process.env.KOENIG_AUDIT_API_USERNAME,
      userPassword: process.env.KOENIG_AUDIT_API_PASSWORD,
      userRole: process.env.KOENIG_AUDIT_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Audit GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Audit GetToken error: ${json.message}`);
  return { accessToken: json.content.accessToken, deviceToken: json.content.deviceToken };
}

async function getToken({ forceRefresh = false } = {}) {
  if (!tokenCache || forceRefresh) tokenCache = await fetchToken();
  return tokenCache;
}

// Enquiry Audit Report. Rows are keyed by CSM display name (`csm_name`), not
// an employee code, so callers have to fuzzy-match names on their end.
export async function getEnquiryAudits(startDate, endDate) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_AUDIT_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_date: startDate, end_date: endDate, csm_user_id: '', client_email_address: '' }),
    });
    if (!res.ok) throw new Error(`Koenig Enquiry Audit common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Enquiry Audit common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return rows
    .filter((r) => r.csm_name)
    .map((r) => ({
      csmName: r.csm_name,
      createdOn: r.created_date_time,
      rating: r.rating,
      remark: r.remark,
      enquiryId: r.enquiry_id,
      clientEmail: r.client_email_adress,
    }));
}

// The rating field comes in inconsistent casing from different upstream
// sources ("below_satisfactory" vs "Below Satisfactory").
export function isNegativeRating(rating) {
  return String(rating || '').trim().toLowerCase() === 'below_satisfactory'
    || String(rating || '').trim().toLowerCase() === 'below satisfactory';
}
