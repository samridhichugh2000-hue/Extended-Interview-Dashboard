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
      userName: process.env.KOENIG_TRAINERRC_API_USERNAME,
      userPassword: process.env.KOENIG_TRAINERRC_API_PASSWORD,
      userRole: process.env.KOENIG_TRAINERRC_API_ROLE,
    }),
  });
  if (!res.ok) throw new Error(`Koenig Trainer RC GetToken failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.statuscode !== 200) throw new Error(`Koenig Trainer RC GetToken error: ${json.message}`);
  return { accessToken: json.content.accessToken, deviceToken: json.content.deviceToken };
}

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

// Trainer RC (Resource Chart) Schedule — one row per (date, activity) for a
// trainer over the given date range. AssociatedType tells the activity apart:
// 'SC' (Scheduled Class — an actual training batch day) is the only type
// that counts as billable delivery; 'Free', 'LV' (leave), 'TD' (travel),
// 'TK'/'MK'/'CM'/'ME'/'CA' (tasks/marking/common-module/meeting/other) are
// not. HrsPerDay carries the hours for that row. TrainerRole ('Main
// Trainer' on SC rows we've seen) distinguishes lead vs co/backup trainer —
// something the plain Trainer Assignment feed (koenigAssignmentApi.js)
// doesn't expose at all.
export async function getTrainerRcSchedule(traineeEmail, fromDate, toDate) {
  const call = async (token) => {
    const url = `${BASE_URL}/api/Kites/Operator/common?apikey=${process.env.KOENIG_TRAINERRC_API_KEY}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ traineremail: traineeEmail, fromDate, toDate }),
    });
    if (!res.ok) throw new Error(`Koenig Trainer RC common API failed: ${res.status} ${res.statusText}`);
    return res.json();
  };

  let token = await getToken();
  let json = await call(token);

  if (json.statuscode !== 200) {
    token = await getToken({ forceRefresh: true });
    json = await call(token);
    if (json.statuscode !== 200) throw new Error(`Koenig Trainer RC common API error: ${json.message}`);
  }

  const rows = typeof json.content === 'string' ? JSON.parse(json.content) : json.content;
  return (rows || []).map((r) => ({
    date: r.Date,
    associatedType: r.AssociatedType,
    assignmentId: r.AssignmentId || null,
    courseName: r.CourseName,
    courseStartDate: r.CourseSDate,
    courseEndDate: r.CourseEDate,
    hrsPerDay: Number(r.HrsPerDay) || 0,
    trainerRole: r.TrainerRole || null,
  }));
}

// Total 'SC' (Scheduled Class) hours a trainer is booked for within a date
// range — used to decide whether they're too deep in an active batch to be
// asked for a weekly check-in this week (see sendCheckIns' fully-booked
// filter in weeklyReportRunner.js).
export function totalScHours(rcRows) {
  return rcRows.filter((r) => r.associatedType === 'SC').reduce((sum, r) => sum + r.hrsPerDay, 0);
}

// Distinct 'SC' assignments this trainer was the Main Trainer on (a batch
// spans several days, each its own row, so this dedupes by assignmentId) —
// the "zero assignments as main trainer" PA Algo check (lib/paAlgo.js) reads
// this instead of the plain Trainer Assignment feed, which has no role field
// to tell a lead trainer apart from a co/backup trainer on the same batch.
export function distinctMainTrainerAssignments(rcRows) {
  const seen = new Map();
  for (const r of rcRows) {
    if (r.associatedType !== 'SC' || r.trainerRole !== 'Main Trainer' || !r.assignmentId) continue;
    if (!seen.has(r.assignmentId)) {
      seen.set(r.assignmentId, { assignmentId: r.assignmentId, courseName: r.courseName, startDate: r.courseStartDate, endDate: r.courseEndDate });
    }
  }
  return [...seen.values()];
}
