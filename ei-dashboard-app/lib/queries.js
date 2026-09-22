import { getDb } from './db';
import { computeSignalReport, computeWorryScore, trendNoteFor, isScoredEmployee } from './data';
import { getIsoWeek, isWeekOver } from './weekUtils';
import { getManagerEmail } from './managerDirectory';

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

  const pipByEmp = new Map();
  for (const row of pipRes.rows) pipByEmp.set(row.employee_id, row);

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
    weeksByEmp.get(row.employee_id).push({ week: row.week, state: effectiveState(row.week, row.state) });
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
      v: [e.metric1, e.metric2, e.metric3, e.metric4, e.metric5, e.metric6],
      alert: e.alert || 'Alert',
      weeks: weeksByEmp.get(e.id) || [],
      feedback: feedbackByEmp.get(e.id) || [],
      hrNote: e.hr_note,
      active: !!e.active,
      negAudits: e.neg_audits,
      auditRemarks: e.audit_remarks ? JSON.parse(e.audit_remarks) : [],
      scRaised: e.sc_raised,
      scDetails: e.sc_details ? JSON.parse(e.sc_details) : [],
      examPass: e.exam_pass,
      examFail: e.exam_fail,
      examTotal: e.exam_total,
      examNotUpdated: e.exam_not_updated,
      negFeedback: e.neg_feedback,
      negFeedbackDetails: e.neg_feedback_details ? JSON.parse(e.neg_feedback_details) : [],
      assignmentsCount: e.assignments_count,
      assignmentsDetails: e.assignments_details ? JSON.parse(e.assignments_details) : [],
      skillsCount: e.skills_count,
      skillsDetails: e.skills_details ? JSON.parse(e.skills_details) : [],
      inHouseSkillsCount: e.in_house_skills_count,
      inHouseSkillsDetails: e.in_house_skills_details ? JSON.parse(e.in_house_skills_details) : [],
      techCallsCount: e.tech_calls_count,
      techCallsDetails: e.tech_calls_details ? JSON.parse(e.tech_calls_details) : [],
      techCallsConverted: e.tech_calls_converted,
      tbtCount: e.tbt_count,
      tbtDetails: e.tbt_details ? JSON.parse(e.tbt_details) : [],
      shoddyNegCount: e.shoddy_neg_count,
      shoddyNegDetails: e.shoddy_neg_details ? JSON.parse(e.shoddy_neg_details) : [],
      shoddyPosCount: e.shoddy_pos_count,
      shoddyPosDetails: e.shoddy_pos_details ? JSON.parse(e.shoddy_pos_details) : [],
      pollsParticipated: e.polls_participated,
      kgtCount: e.kgt_count,
      kgtDetails: e.kgt_details ? JSON.parse(e.kgt_details) : [],
      mgrFeedbackCount: e.mgr_feedback_count,
      mgrFeedbackDetails: e.mgr_feedback_details ? JSON.parse(e.mgr_feedback_details) : [],
      meetingsCount: e.meetings_count,
      meetingsLateCount: e.meetings_late_count,
      meetingsMissedCount: e.meetings_missed_count,
      avIssueCount: e.av_issue_count,
      externalEmailCount: e.external_email_count,
      externalEmailDetails: e.external_email_details ? JSON.parse(e.external_email_details) : [],
      externalEmailDaily: e.external_email_daily ? JSON.parse(e.external_email_daily) : [],
      ideasCount: e.ideas_count,
      ideasDetails: e.ideas_details ? JSON.parse(e.ideas_details) : [],
      rosterCount: e.roster_count,
      rosterDetails: e.roster_details ? JSON.parse(e.roster_details) : [],
      commonIndexPoints: e.common_index_points,
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
    };
  });
}

// Graph API Calls screen: every tracked Teams meeting instance, newest
// first, joined against the employee for name/team display. av_issue is
// null (not 0/1) until a callRecords webhook notification has matched this
// meeting — that's a real "no data yet" state, distinct from a confirmed
// clean call.
export async function getGraphMeetings() {
  const db = getDb();
  const res = await db.execute(`
    SELECT gm.*, e.name AS emp_name, e.team AS emp_team
    FROM graph_meetings gm
    JOIN employees e ON e.id = gm.employee_id
    ORDER BY gm.scheduled_start DESC
  `);
  return res.rows.map((r) => ({
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
    callRecordId: r.call_record_id,
    avIssue: r.av_issue == null ? null : !!r.av_issue,
    avIssueDetails: r.av_issue_details ? JSON.parse(r.av_issue_details) : null,
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
