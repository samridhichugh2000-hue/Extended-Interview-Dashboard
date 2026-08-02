import { getDb } from './db';
import { computeSignalReport, computeWorryScore, trendNoteFor } from './data';

// Rebuilds each employee into the exact shape the UI components expect
// (same fields as the old lib/data.js mock EMP array) so screens/decorate()
// don't need to change — only the data source does.
export async function getEmployees() {
  const db = getDb();

  const [empRes, pipRes, feedbackRes] = await Promise.all([
    db.execute('SELECT * FROM employees'),
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
  const weeksRes = await db.execute('SELECT * FROM weekly_responses ORDER BY week ASC');
  const weeksByEmp = new Map();
  for (const row of weeksRes.rows) {
    if (!weeksByEmp.has(row.employee_id)) weeksByEmp.set(row.employee_id, []);
    weeksByEmp.get(row.employee_id).push({ week: row.week, state: row.state });
  }

  return empRes.rows.map((e) => {
    const pip = pipByEmp.get(e.id);
    const base = {
      id: e.id,
      name: e.name,
      email: e.email,
      team: e.team,
      manager: e.manager,
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
      techCallsCount: e.tech_calls_count,
      techCallsDetails: e.tech_calls_details ? JSON.parse(e.tech_calls_details) : [],
      techCallsConverted: e.tech_calls_converted,
      tbtCount: e.tbt_count,
      tbtDetails: e.tbt_details ? JSON.parse(e.tbt_details) : [],
      shoddyNegCount: e.shoddy_neg_count,
      shoddyNegDetails: e.shoddy_neg_details ? JSON.parse(e.shoddy_neg_details) : [],
      shoddyPosCount: e.shoddy_pos_count,
      shoddyPosDetails: e.shoddy_pos_details ? JSON.parse(e.shoddy_pos_details) : [],
    };
    // Worry Index score/signals/trend are derived live from the real synced
    // fields above rather than read off employees.score, which is only ever
    // written once (as 0) at insert time and never recalculated. signalReport
    // covers every parameter that applies to this team (fired, clear, no-data
    // or not-tracked) — see computeSignalReport in lib/data.js; only the
    // 'fired' ones count toward the score.
    const signalReport = computeSignalReport(base);
    const signals = signalReport.filter((s) => s.status === 'fired');
    return {
      ...base,
      signals,
      signalReport,
      score: computeWorryScore(signals),
      trendNote: trendNoteFor(signals),
    };
  });
}

export async function getWeeklyResponses(week) {
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT wr.*, e.name, e.team FROM weekly_responses wr
          JOIN employees e ON e.id = wr.employee_id
          WHERE wr.week = ? AND wr.sent_at IS NOT NULL
          ORDER BY e.name ASC`,
    args: [week],
  });
  return res.rows.map((r) => ({
    name: r.name,
    team: r.team,
    sent: r.sent_at,
    received: r.received_at || '—',
    state: r.state,
    ai: r.ai_rating || '—',
    q1: r.q1, a1: r.a1, q2: r.q2, a2: r.a2,
  }));
}
