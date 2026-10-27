import { getDb } from './db.js';
import { VIDEO_MIN_ATTEND_SECONDS, videoWindowStart, videoMeetingQualifies } from './videoRules.js';
import { isExcludedGraphMeeting } from './meetingFilters.js';
import { computeSignalReport, computeWorryScore, trendNoteFor, isScoredEmployee } from './data.js';
import { getIsoWeek, isWeekOver } from './weekUtils.js';
import { getManagerEmail } from './managerDirectory.js';
import { computeTrainerPaAlgoFlag, computeSalesPaAlgoFlag } from './paAlgo.js';

// A 'Pending' response for a week that has fully passed reads as 'Overdue' —
// derived live at read time rather than stored, same "derive, don't
// persist" approach already used for Worry Index scores.
function effectiveState(week, rawState) {
  return rawState === 'Pending' && isWeekOver(week) ? 'Overdue' : rawState;
}

// Rebuilds each employee into the exact shape the UI components expect
// (same fields as the old lib/data.js mock EMP array) so screens/decorate()
// don't need to change — only the data source does.
export async function getEmployees() {
  const db = getDb();

  // Every tracked employee, regardless of tenure — this used to cap at
  // tenure_days < 365 (a leftover from when nobody in the table could be
  // longer-tenured than that anyway), which silently hid every veteran once
  // the full active roster got imported (see syncKoenig). Newest joiners
  // first, then increasing tenure — screens that need a different order
  // (e.g. Worry Index score) re-sort explicitly on top of this.
  const [empRes, pipRes, feedbackRes] = await Promise.all([
    db.execute('SELECT * FROM employees ORDER BY tenure_days ASC'),
    db.execute('SELECT * FROM pip_status'),
    db.execute('SELECT * FROM manager_feedback'),
  ]);

  // Camera-on tracking (syncVideo): qualifying Teams meetings in the window and
  // how many of them had the camera on. Table may not exist before the first run.
  const videoRes = await db.execute({
    sql: `SELECT employee_id, is_external, camera_on, COUNT(*) AS n FROM video_meetings
          WHERE started_at >= ? AND attended_seconds >= ? GROUP BY employee_id, is_external, camera_on`,
    args: [videoWindowStart(), VIDEO_MIN_ATTEND_SECONDS],
  }).catch(() => ({ rows: [] }));
  const videoRowsByEmp = new Map();
  for (const r of videoRes.rows) {
    if (!videoRowsByEmp.has(r.employee_id)) videoRowsByEmp.set(r.employee_id, []);
    videoRowsByEmp.get(r.employee_id).push({ external: !!r.is_external, cam: !!r.camera_on, n: Number(r.n) });
  }

  // Employees whose unreplied list is saved (see lib/unrepliedStore.js): only
  // for them does the saved count match what "Load emails" shows. The table is
  // created lazily, so a missing table just means nobody is saved yet.
  const unrepliedSaved = new Set(
    (await db.execute('SELECT employee_id FROM unreplied_lists_saved').catch(() => ({ rows: [] }))).rows.map((r) => r.employee_id),
  );

  const pipByEmp = new Map();
  // Every incident per employee, not just one — pipByEmp above only keeps
  // whichever row a plain table scan happens to end on, which is fine for
  // the single issued/due display fields below but not enough to answer
  // "was this employee in PA/PIP at any point recently" once their case has
  // since closed and employees.status moved on to In Progress/Confirmed.
  const pipHistoryByEmp = new Map();
  for (const row of pipRes.rows) {
    pipByEmp.set(row.employee_id, row);
    if (!pipHistoryByEmp.has(row.employee_id)) pipHistoryByEmp.set(row.employee_id, []);
    pipHistoryByEmp.get(row.employee_id).push({ type: row.type, issuedOn: row.issued_on, reviewBy: row.review_by, isActive: !!row.is_active });
  }

  const feedbackByEmp = new Map();
  for (const row of feedbackRes.rows) {
    if (!feedbackByEmp.has(row.employee_id)) feedbackByEmp.set(row.employee_id, []);
    feedbackByEmp.get(row.employee_id).push({ milestone: row.milestone, quality: row.quality, comment: row.comment });
  }

  // weekly_responses doubles as both the per-employee 4-week history (state only)
  // and, for the current week, the full response-tracker row used on Reports.
  const currentWeek = getIsoWeek(new Date());
  const weeksRes = await db.execute('SELECT * FROM weekly_responses ORDER BY week ASC');
  const weeksByEmp = new Map();
  for (const row of weeksRes.rows) {
    if (!weeksByEmp.has(row.employee_id)) weeksByEmp.set(row.employee_id, []);
    weeksByEmp.get(row.employee_id).push({
      week: row.week,
      state: effectiveState(row.week, row.state),
      aiRating: row.ai_rating != null && row.ai_rating !== '' ? Number(row.ai_rating) : null,
      receivedAt: row.received_at,
    });
  }

  return empRes.rows.map((e) => {
    const pip = pipByEmp.get(e.id);
    const base = {
      id: e.id,
      name: e.name,
      email: e.email,
      team: e.team,
      manager: e.manager,
      managerEmail: getManagerEmail(e.manager),
      doj: e.doj,
      tenure: e.tenure_days,
      status: e.status,
      issued: pip?.issued_on || '—',
      due: pip?.review_by || '—',
      breaches: pip?.breaches ? JSON.parse(pip.breaches) : [],
      pipHistory: pipHistoryByEmp.get(e.id) || [],
      v: [e.metric1, e.metric2, e.metric3, e.metric4, e.metric5, e.metric6],
      alert: e.alert || 'Alert',
      weeks: weeksByEmp.get(e.id) || [],
      feedback: feedbackByEmp.get(e.id) || [],
      hrNote: e.hr_note,
      active: !!e.active,
      resignedOn: e.dor || null,   // date of resignation, while still on the dashboard
      lastWorkingDay: e.lwd || null,
      negAudits: e.neg_audits,
      auditRemarks: e.audit_remarks ? JSON.parse(e.audit_remarks) : [],
      scRaised: e.sc_raised,
      scDetails: e.sc_details ? JSON.parse(e.sc_details) : [],
      examPass: e.exam_pass,
      examFail: e.exam_fail,
      examTotal: e.exam_total,
      examNotUpdated: e.exam_not_updated,
      examDetails: e.exam_details ? JSON.parse(e.exam_details) : [],
      negFeedback: e.neg_feedback,
      negFeedbackDetails: e.neg_feedback_details ? JSON.parse(e.neg_feedback_details) : [],
      assignmentsCount: e.assignments_count,
      assignmentsDetails: e.assignments_details ? JSON.parse(e.assignments_details) : [],
      rcMainAssignmentsCount: e.rc_main_assignments_count,
      rcMainAssignmentsDetails: e.rc_main_assignments_details ? JSON.parse(e.rc_main_assignments_details) : [],
      skillsCount: e.skills_count,
      skillsDetails: e.skills_details ? JSON.parse(e.skills_details) : [],
      inHouseSkillsCount: e.in_house_skills_count,
      inHouseSkillsDetails: e.in_house_skills_details ? JSON.parse(e.in_house_skills_details) : [],
      techCallsCount: e.tech_calls_count,
      techCallsDetails: e.tech_calls_details ? JSON.parse(e.tech_calls_details) : [],
      techCallsConverted: e.tech_calls_converted,
      techCallsConvertedDetails: e.tech_calls_converted_details ? JSON.parse(e.tech_calls_converted_details) : [],
      tbtCount: e.tbt_count,
      tbtDetails: e.tbt_details ? JSON.parse(e.tbt_details) : [],
      shoddyNegCount: e.shoddy_neg_count,
      shoddyNegDetails: e.shoddy_neg_details ? JSON.parse(e.shoddy_neg_details) : [],
      shoddyPosCount: e.shoddy_pos_count,
      shoddyPosDetails: e.shoddy_pos_details ? JSON.parse(e.shoddy_pos_details) : [],
      pollsParticipated: e.polls_participated,
      pollsDetails: e.polls_details ? JSON.parse(e.polls_details) : [],
      kgtCount: e.kgt_count,
      kgtDetails: e.kgt_details ? JSON.parse(e.kgt_details) : [],
      fmInterviewsCount: e.fm_interviews_count,
      fmInterviewsDetails: e.fm_interviews_details ? JSON.parse(e.fm_interviews_details) : [],
      recruiterInterviewsCount: e.recruiter_interviews_count,
      recruiterInterviewsDetails: e.recruiter_interviews_details ? JSON.parse(e.recruiter_interviews_details) : [],
      mgrFeedbackCount: e.mgr_feedback_count,
      mgrFeedbackDetails: e.mgr_feedback_details ? JSON.parse(e.mgr_feedback_details) : [],
      unrepliedEmailCount: e.unreplied_email_count,
      unrepliedEmailTotal: e.unreplied_email_total,
      unrepliedReviewCount: e.unreplied_review_count,
      unrepliedSyncedAt: e.unreplied_synced_at,
      unrepliedListSaved: unrepliedSaved.has(e.id),
      meetingsCount: e.meetings_count,
      meetingsLateCount: e.meetings_late_count,
      meetingsMissedCount: e.meetings_missed_count,
      avIssueCount: e.av_issue_count,
      externalEmailCount: e.external_email_count,
      externalEmailDetails: e.external_email_details ? JSON.parse(e.external_email_details) : [],
      externalEmailDaily: e.external_email_daily ? JSON.parse(e.external_email_daily) : [],
      lowRmsDays: e.low_activity_synced_at && e.low_rms_days ? JSON.parse(e.low_rms_days) : null,
      lowEmailDays: e.low_activity_synced_at && e.low_email_days ? JSON.parse(e.low_email_days) : null,
      lowMeetingDays: e.low_activity_synced_at && e.low_meeting_days ? JSON.parse(e.low_meeting_days) : null,
      lowActivityMeta: e.low_activity_meta ? JSON.parse(e.low_activity_meta) : null,
      ideasCount: e.ideas_count,
      ideasDetails: e.ideas_details ? JSON.parse(e.ideas_details) : [],
      rosterCount: e.roster_count,
      rosterDetails: e.roster_details ? JSON.parse(e.roster_details) : [],
      commonIndexPoints: e.common_index_points,
      salary: e.salary,
      country: e.country,
      designation: e.designation,
      utilMonthlyDetails: e.util_monthly_details ? JSON.parse(e.util_monthly_details) : [],
      nrMonthlyDetails: e.nr_monthly_details ? JSON.parse(e.nr_monthly_details) : [],
      trueNrDetails: e.true_nr_details ? JSON.parse(e.true_nr_details) : [],
      appraisalDetails: e.appraisal_details ? JSON.parse(e.appraisal_details) : [],
      nrFutureDetails: e.nr_future_details ? JSON.parse(e.nr_future_details) : null,
      quarterTargetPct: e.quarter_target_pct,
      quarterTargetName: e.quarter_target_name,
      quarterTargetYear: e.quarter_target_year,
      quarterTargetRemarks: e.quarter_target_remarks,
      quarterTargetAmount: e.quarter_target_amount,
      quarterTargetType: e.quarter_target_type,
      quarterTargets: e.quarter_targets ? JSON.parse(e.quarter_targets) : [],
      teamNrDetails: e.team_nr_details ? JSON.parse(e.team_nr_details) : null,
      externalMeetingsCount: e.external_meetings_count,
      ...(() => {
        const rows = (videoRowsByEmp.get(e.id) || []).filter((r) => videoMeetingQualifies(e.team, r.external));
        return { videoMeetings: rows.reduce((a, r) => a + r.n, 0), videoOn: rows.filter((r) => r.cam).reduce((a, r) => a + r.n, 0) };
      })(),
      pipelineMonths: e.pipeline_months ? JSON.parse(e.pipeline_months) : null,
      pipelineUndatedNr: e.pipeline_undated_nr,
      pipelineUndatedDeals: e.pipeline_undated_deals,
      pipelineTotalNr: e.pipeline_total_nr,
      pipelineTotalDeals: e.pipeline_total_deals,
      pipelineSyncedAt: e.pipeline_synced_at,
      // null = no weekly_responses row yet for this week (e.g. feature hasn't
      // been run for them this week) — distinct from a confirmed Pending/Overdue.
      weeklyReportState: (weeksByEmp.get(e.id) || []).find((w) => w.week === currentWeek)?.state ?? null,
    };
    // Worry Index score/signals/trend are derived live from the real synced
    // fields above rather than read off employees.score, which is only ever
    // written once (as 0) at insert time and never recalculated. signalReport
    // covers every parameter that applies to this team (fired, clear, no-data
    // or not-tracked) — see computeSignalReport in lib/data.js; only the
    // 'fired' ones count toward the score.
    //
    // Scoring only applies to New Joiners and active PA/PIP cases (see
    // isScoredEmployee) — every count-based signal is "since joining"/
    // all-time, which explodes into meaningless numbers over a multi-year
    // veteran's tenure. Everyone else gets score/signals as null — band()
    // and decorate() already render that as "Not scored" / "—" rather than
    // a broken number.
    const scored = isScoredEmployee(base);
    const signalReport = scored ? computeSignalReport(base) : [];
    const signals = signalReport.filter((s) => s.status === 'fired');
    return {
      ...base,
      signals,
      signalReport,
      score: scored ? computeWorryScore(signals) : null,
      trendNote: scored ? trendNoteFor(signals) : 'Not scored — outside the New Joiner / active PA-PIP window.',
      // Proposed PA/PIP candidacy from delivery numbers (assignments/
      // utilization) vs salary tier, or (Sales) Net Revenue vs salary/an
      // absolute bar — see lib/paAlgo.js. Neither writes to pip_status.
      trainerPaAlgo: base.team === 'Trainer' ? computeTrainerPaAlgoFlag(base) : null,
      salesPaAlgo: base.team === 'Sales' ? computeSalesPaAlgoFlag(base) : null,
    };
  });
}

// Graph API Calls screen: every tracked Teams meeting instance, newest
// first, joined against the employee for name/team display. av_issue is
// null (not 0/1) until a callRecords webhook notification has matched this
// meeting — that's a real "no data yet" state, distinct from a confirmed
// clean call.
//
// Excludes only meetings organized by Gunjan Setia (692 of 3646 total rows)
// — her recurring internal briefings were never meant to be tracked here.
// Every other organizer stays in, internal (FM team, other Koenig staff) and
// external (real client domains) alike — this is specifically a Gunjan
// exclusion, not a blanket internal-vs-external filter.
const EXCLUDED_ORGANIZERS = ['gunjan.setia@koenig-solutions.com'];
export async function getGraphMeetings() {
  const db = getDb();
  const res = await db.execute({
    sql: `
      SELECT gm.*, e.name AS emp_name, e.team AS emp_team
      FROM graph_meetings gm
      JOIN employees e ON e.id = gm.employee_id
      WHERE lower(gm.organizer_email) NOT IN (${EXCLUDED_ORGANIZERS.map(() => '?').join(',')})
      ORDER BY gm.scheduled_start DESC
    `,
    args: EXCLUDED_ORGANIZERS,
  });
  return res.rows.filter((r) => {
    let clients = [];
    try { clients = JSON.parse(r.client_emails || '[]'); } catch { /* treat as internal */ }
    return !isExcludedGraphMeeting(r.subject, r.emp_team, clients);
  }).map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.emp_name,
    team: r.emp_team,
    subject: r.subject || '(no subject)',
    organizerEmail: r.organizer_email,
    scheduledStart: r.scheduled_start,
    scheduledEnd: r.scheduled_end,
    joinedAt: r.joined_at,
    leftAt: r.left_at,
    attendanceSeconds: r.attendance_seconds,
    delaySeconds: r.delay_seconds,
    timingStatus: r.timing_status,
    // No online meeting could be resolved for the organizer (Teams application
    // access policy doesn't cover them, or they are outside the tenant), so no
    // attendance report is obtainable.
    attendanceUnavailable: !r.online_meeting_id && r.timing_status === 'No Data',
    callRecordId: r.call_record_id,
    avIssue: r.av_issue == null ? null : !!r.av_issue,
    avIssueDetails: r.av_issue_details ? JSON.parse(r.av_issue_details) : null,
    clientEmails: r.client_emails ? JSON.parse(r.client_emails) : [],
    recordingCount: r.recording_count == null ? null : Number(r.recording_count),
    syncedAt: r.synced_at,
  }));
}

export async function getWeeklyResponses(week) {
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT wr.*, e.name, e.team, e.active FROM weekly_responses wr
          JOIN employees e ON e.id = wr.employee_id
          WHERE wr.week = ? AND wr.sent_at IS NOT NULL
          ORDER BY e.name ASC`,
    args: [week],
  });
  return res.rows.map((r) => ({
    name: r.name,
    team: r.team,
    active: !!r.active,
    sent: r.sent_at,
    received: r.received_at || '—',
    state: effectiveState(r.week, r.state),
    ai: r.ai_rating || '—',
    aiReason: r.ai_rating_reason || null,
    q1: r.q1, a1: r.a1, q2: r.q2, a2: r.a2,
  }));
}

// For the public /respond/[token] page — looked up directly by token, no
// auth beyond knowing the (unguessable) token itself.
export async function getResponseByToken(token) {
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT wr.*, e.name, e.team FROM weekly_responses wr
          JOIN employees e ON e.id = wr.employee_id
          WHERE wr.token = ?`,
    args: [token],
  });
  const r = res.rows[0];
  if (!r) return null;
  return {
    name: r.name,
    team: r.team,
    week: r.week,
    state: r.state,
    q1: r.q1, a1: r.a1, q2: r.q2, a2: r.a2,
  };
}

// ---- home-page payload slimming ----
// The dashboard used to ship every employee's full *_details lists to the
// browser (~38 MB). The client only needs a few date fields from the big
// ones to recompute windowed Worry Index signals (lib/data.js) and the "No SC
// within 30 days" filter, so the page gets those trimmed to just the keys
// that code reads; the full rows are fetched per employee when a popup that
// lists them opens (getEmployeeDetails, via /api/employees/[id]/details).
// If lib/data.js starts reading another key from one of these lists, add it
// to SLIM_KEYS or that signal will silently count zero.
const SLIM_KEYS = {
  scDetails: ['createdOn'],
  skillsDetails: ['skillAvailableDate'],
  inHouseSkillsDetails: ['markDate'],
  techCallsConvertedDetails: ['date', 'converted'],
  assignmentsDetails: ['startDate', 'endDate'],
  negFeedbackDetails: ['feedbackDate'],
};
// Never read by the client at all.
const CLIENT_UNUSED = ['rcMainAssignmentsDetails', 'externalEmailDetails', 'rosterDetails'];

export function slimEmployeesForClient(employees) {
  return employees.map((e) => {
    const out = { ...e };
    for (const k of CLIENT_UNUSED) delete out[k];
    for (const [field, keys] of Object.entries(SLIM_KEYS)) {
      out[field] = (e[field] || []).map((r) => Object.fromEntries(keys.map((k) => [k, r?.[k] ?? null])));
    }
    return out;
  });
}

export async function getEmployeeDetails(id) {
  const db = getDb();
  const res = await db.execute({
    sql: 'SELECT sc_details, neg_feedback_details, assignments_details, skills_details, in_house_skills_details, tech_calls_converted_details FROM employees WHERE id = ?',
    args: [id],
  });
  const e = res.rows[0];
  if (!e) return null;
  const parse = (v) => (v ? JSON.parse(v) : []);
  return {
    scDetails: parse(e.sc_details),
    negFeedbackDetails: parse(e.neg_feedback_details),
    assignmentsDetails: parse(e.assignments_details),
    skillsDetails: parse(e.skills_details),
    inHouseSkillsDetails: parse(e.in_house_skills_details),
    techCallsConvertedDetails: parse(e.tech_calls_converted_details),
  };
}
