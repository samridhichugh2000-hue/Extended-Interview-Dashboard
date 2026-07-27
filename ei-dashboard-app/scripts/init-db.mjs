import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const schema = readFileSync(path.join(__dirname, '..', 'lib', 'schema.sql'), 'utf-8');
const statements = schema.split(';').map((s) => s.trim()).filter(Boolean);
for (const stmt of statements) await db.execute(stmt);
console.log('Schema applied.');

// Migration for tables created before metric1/metric2/metric3/alert existed.
for (const col of ['metric1', 'metric2', 'metric3', 'alert']) {
  try {
    await db.execute(`ALTER TABLE employees ADD COLUMN ${col} TEXT`);
  } catch (err) {
    if (!String(err.message).includes('duplicate column')) throw err;
  }
}

const EMP = [
  {
    id: 'EMP4861', name: 'Aarav Mehta', team: 'Sales', manager: 'R. Khanna', doj: '12 Mar 26', tenure: 137,
    status: 'PIP Issued', score: -6.5, issued: '02 Jul 26', due: '02 Aug 26',
    breaches: ['Weekly email missed ×3', 'Negative audit', 'Below satisfactory'],
    v: ['₹0.0L', '₹1.2L', '₹0.4L'], alert: 'Alert',
    signals: [
      { label: 'Weekly email not received (×3)', weight: 'average', pts: -3.0 },
      { label: 'Negative enquiry audit', weight: 'major', pts: -2.0 },
      { label: 'Manager feedback below satisfactory', weight: 'average', pts: -1.0 },
      { label: 'Not on time for meetings', weight: 'major', pts: -2.0 },
      { label: 'Tech calls attended (4)', weight: 'average', pts: 1.0 },
      { label: 'Polls participated', weight: 'minor', pts: 0.5 },
    ],
    weeks: [
      { week: '2026-W27', state: 'No response' },
      { week: '2026-W28', state: 'No response' },
      { week: '2026-W29', state: 'Received · low progress' },
      { week: '2026-W30', state: 'No response' },
    ],
    feedback: [
      { milestone: 'd30', quality: 'satisfactory', comment: 'Settling in, pipeline still thin.' },
      { milestone: 'd60', quality: 'below', comment: 'Missed two committed follow-ups.' },
      { milestone: 'd90', quality: 'below', comment: 'No net revenue in month 3.' },
    ],
    hrNote: 'PIP issued 02 Jul after third consecutive missed weekly email. Review meeting scheduled with R. Khanna on 01 Aug.',
    trendNote: 'Down 2.5 points week on week. Third consecutive declining week.',
  },
  {
    id: 'EMP4902', name: 'Sneha Kapoor', team: 'Trainer', manager: 'M. Iyer', doj: '02 Apr 26', tenure: 116,
    status: 'PIP Issued', score: -5.0, issued: '10 Jul 26', due: '10 Aug 26',
    breaches: ['Zero assignments', 'Exam failure', 'Weekly email missed'], v: ['38%', '44%', '29%'], alert: 'Alert',
    signals: [
      { label: 'Failure in exam', weight: 'major', pts: -2.0 },
      { label: 'Zero assignments 2 weeks ahead', weight: 'average', pts: -1.0 },
      { label: 'Weekly email shows less progress', weight: 'major', pts: -2.0 },
      { label: 'Skills count ≥ weeks since joining', weight: 'average', pts: 1.0 },
      { label: 'Not replying to HR emails', weight: 'average', pts: -1.0 },
    ],
    weeks: [
      { week: '2026-W27', state: 'Received' },
      { week: '2026-W28', state: 'Received · low progress' },
      { week: '2026-W29', state: 'No response' },
      { week: '2026-W30', state: 'Received · low progress' },
    ],
    feedback: [
      { milestone: 'd30', quality: 'satisfactory', comment: 'Good grasp of core course content.' },
      { milestone: 'd60', quality: 'below', comment: 'Delivery feedback from client was negative.' },
    ],
    hrNote: 'Re-training on Azure track agreed with M. Iyer. Reassess at day 130.',
    trendNote: 'Flat for two weeks after a sharp drop at day 100.',
  },
  {
    id: 'EMP4877', name: 'Rohit Verma', team: 'Sales', manager: 'R. Khanna', doj: '20 Feb 26', tenure: 157,
    status: 'PA Issued', score: -3.5, issued: '18 Jun 26', due: '18 Aug 26',
    breaches: ['Zero SC raised', 'Below satisfactory'], v: ['₹2.1L', '₹1.8L', '₹0.9L'], alert: 'Alert',
    signals: [
      { label: 'Zero SCs raised', weight: 'average', pts: -1.0 },
      { label: 'Manager feedback below satisfactory', weight: 'average', pts: -1.0 },
      { label: 'Audio/video not OK in meetings', weight: 'average', pts: -1.0 },
      { label: 'Shoddy marked against NJ', weight: 'average', pts: -1.0 },
      { label: 'Ideas for improvement (2)', weight: 'average', pts: 0.5 },
    ],
    weeks: [
      { week: '2026-W28', state: 'Received' },
      { week: '2026-W29', state: 'Received · low progress' },
      { week: '2026-W30', state: 'Received' },
    ],
    feedback: [
      { milestone: 'd30', quality: 'satisfactory', comment: 'Strong client rapport.' },
      { milestone: 'd90', quality: 'below', comment: 'Revenue trending down month on month.' },
    ],
    hrNote: 'PA issued 18 Jun. Improvement visible in W30 — hold before escalating.',
    trendNote: 'Up 1 point this week. First improvement since day 120.',
  },
  {
    id: 'EMP4915', name: 'Priya Nair', team: 'PT Team', manager: 'S. Bhatt', doj: '05 May 26', tenure: 83,
    status: 'PA Issued', score: -2.0, issued: '12 Jul 26', due: '12 Sep 26',
    breaches: ['Shoddy received', 'Common Index below cut-off'], v: ['12', '3', '1'], alert: 'Alert',
    signals: [
      { label: 'Shoddy marked against NJ', weight: 'average', pts: -1.0 },
      { label: 'RMS tasks below cut-off', weight: 'average', pts: -1.5 },
      { label: 'Process improvements implemented', weight: 'average', pts: 1.0 },
      { label: 'Applied for KGT', weight: 'average', pts: 0.5 },
      { label: 'Weekly email not received', weight: 'average', pts: -1.0 },
    ],
    weeks: [
      { week: '2026-W29', state: 'Received' },
      { week: '2026-W30', state: 'No response' },
    ],
    feedback: [
      { milestone: 'd30', quality: 'satisfactory', comment: 'Picks up RMS workflows quickly.' },
      { milestone: 'd60', quality: 'below', comment: 'Work-from-home connectivity issues repeatedly.' },
    ],
    hrNote: 'WFH setup audit requested. Escalate only if W31 email is also missed.',
    trendNote: 'Down 1 point. Two criteria below cut-off this week.',
  },
  {
    id: 'EMP4930', name: 'Karan Shah', team: 'Sales', manager: 'A. Desai', doj: '18 Apr 26', tenure: 100,
    status: 'In Progress', score: 1.5, issued: null, due: null,
    breaches: ['Feedback pending'], v: ['₹1.4L', '₹3.2L', '₹2.8L'], alert: 'Alert',
    signals: [
      { label: 'Tech calls attended (9)', weight: 'average', pts: 2.0 },
      { label: 'SCs raised (3)', weight: 'average', pts: 1.0 },
      { label: 'Manager feedback pending', weight: 'average', pts: -1.0 },
      { label: 'Not on time for meetings', weight: 'major', pts: -1.0 },
      { label: 'Polls participated', weight: 'minor', pts: 0.5 },
    ],
    weeks: [
      { week: '2026-W29', state: 'Received' },
      { week: '2026-W30', state: 'Received' },
    ],
    feedback: [
      { milestone: 'd30', quality: 'above', comment: 'Best ramp-up in the cohort.' },
      { milestone: 'd60', quality: 'satisfactory', comment: 'Consistent pipeline growth.' },
    ],
    hrNote: 'No action. Chase A. Desai for the overdue d90 feedback.',
    trendNote: 'Steady. Manager feedback overdue by 6 days.',
  },
  {
    id: 'EMP4948', name: 'Ishaan Rao', team: 'Trainer', manager: 'M. Iyer', doj: '01 Jun 26', tenure: 56,
    status: 'In Progress', score: 3.0, issued: null, due: null,
    breaches: [], v: ['61%', '72%', '—'], alert: 'Alert',
    signals: [
      { label: 'TBTs requested (5)', weight: 'average', pts: 2.0 },
      { label: 'Marking course inhouse', weight: 'minor', pts: 0.5 },
      { label: 'Skills count ≥ weeks since joining', weight: 'average', pts: 1.0 },
      { label: 'Weekly email shows less progress', weight: 'major', pts: -0.5 },
    ],
    weeks: [
      { week: '2026-W29', state: 'Received' },
      { week: '2026-W30', state: 'Received' },
    ],
    feedback: [{ milestone: 'd30', quality: 'above', comment: 'Two skills added ahead of schedule.' }],
    hrNote: 'On track. No monitoring required after day 90 if trend holds.',
    trendNote: 'Up 1.5 points. Best trajectory in the Trainer cohort.',
  },
];

const RESPONSES = [
  { name: 'Aarav Mehta', sent: 'Mon 09:00', received: null, state: 'Overdue', ai: '—', q1: null, a1: null, q2: null, a2: null },
  { name: 'Sneha Kapoor', sent: 'Mon 09:00', received: 'Tue 18:40', state: 'Received', ai: 'Low progress',
    q1: 'What course did you upgrade to last week?', a1: 'Still on the Azure fundamentals track, did not move to the next module.',
    q2: 'Which course will you upgrade to this week?', a2: 'Planning to start AZ-104 but waiting on lab access.' },
  { name: 'Rohit Verma', sent: 'Mon 09:00', received: 'Mon 14:02', state: 'Received', ai: 'Satisfactory',
    q1: 'What were your achievements of last week?', a1: 'Closed one SC worth ₹0.4L and had 3 client discovery calls.',
    q2: 'How do you plan to increase your pipeline this week?', a2: 'Following up with 2 warm leads from the webinar and prospecting 10 new accounts.' },
  { name: 'Karan Shah', sent: 'Mon 09:00', received: 'Mon 10:15', state: 'Received', ai: 'Above',
    q1: 'What were your achievements of last week?', a1: 'Hit ₹3.2L in net revenue, best week so far. Attended 9 tech calls.',
    q2: 'How do you plan to increase your pipeline this week?', a2: 'Targeting 2 enterprise accounts flagged by the SDR team.' },
  { name: 'Priya Nair', sent: 'Mon 09:00', received: null, state: 'Overdue', ai: '—', q1: null, a1: null, q2: null, a2: null },
];
const WEEK = '2026-W30';

for (const e of EMP) {
  await db.execute({
    sql: `INSERT INTO employees (id, name, team, manager, doj, tenure_days, status, score, trend_note, hr_note, metric1, metric2, metric3, alert)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, team=excluded.team, manager=excluded.manager, doj=excluded.doj,
            tenure_days=excluded.tenure_days, status=excluded.status, score=excluded.score,
            trend_note=excluded.trend_note, hr_note=excluded.hr_note,
            metric1=excluded.metric1, metric2=excluded.metric2, metric3=excluded.metric3, alert=excluded.alert`,
    args: [e.id, e.name, e.team, e.manager, e.doj, e.tenure, e.status, e.score, e.trendNote, e.hrNote, e.v[0], e.v[1], e.v[2], e.alert],
  });

  // Clear and re-insert child rows so this script stays idempotent.
  await db.execute({ sql: 'DELETE FROM pip_status WHERE employee_id = ?', args: [e.id] });
  if (e.status === 'PA Issued' || e.status === 'PIP Issued') {
    await db.execute({
      sql: 'INSERT INTO pip_status (employee_id, type, issued_on, review_by, breaches) VALUES (?, ?, ?, ?, ?)',
      args: [e.id, e.status === 'PIP Issued' ? 'PIP' : 'PA', e.issued, e.due, JSON.stringify(e.breaches)],
    });
  }

  await db.execute({ sql: 'DELETE FROM hr_incidents WHERE employee_id = ?', args: [e.id] });
  for (const s of e.signals) {
    await db.execute({
      sql: 'INSERT INTO hr_incidents (employee_id, label, weight, points) VALUES (?, ?, ?, ?)',
      args: [e.id, s.label, s.weight, s.pts],
    });
  }

  await db.execute({ sql: 'DELETE FROM manager_feedback WHERE employee_id = ?', args: [e.id] });
  for (const f of e.feedback) {
    await db.execute({
      sql: 'INSERT INTO manager_feedback (employee_id, milestone, quality, comment) VALUES (?, ?, ?, ?)',
      args: [e.id, f.milestone, f.quality, f.comment],
    });
  }

  await db.execute({ sql: 'DELETE FROM weekly_responses WHERE employee_id = ?', args: [e.id] });
  for (const w of e.weeks) {
    await db.execute({
      sql: 'INSERT INTO weekly_responses (employee_id, week, state) VALUES (?, ?, ?)',
      args: [e.id, w.week, w.state],
    });
  }
}

// Overlay the current-week response tracker (Reports screen) with full Q&A text.
for (const r of RESPONSES) {
  const emp = EMP.find((e) => e.name === r.name);
  if (!emp) continue;
  await db.execute({
    sql: `UPDATE weekly_responses SET sent_at=?, received_at=?, state=?, q1=?, a1=?, q2=?, a2=?, ai_rating=?
          WHERE employee_id=? AND week=?`,
    args: [r.sent, r.received, r.state, r.q1, r.a1, r.q2, r.a2, r.ai, emp.id, WEEK],
  });
}

console.log(`Seeded ${EMP.length} employees with pip_status, hr_incidents, manager_feedback, weekly_responses.`);

const check = await db.execute('SELECT id, name, team, score, metric1, metric2, metric3 FROM employees ORDER BY score ASC');
console.log('Current employees table:');
for (const row of check.rows) console.log(' ', row.id, row.name, row.team, row.score, row.metric1, row.metric2, row.metric3);
