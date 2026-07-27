export const C = { rose: '#F43F5E', amber: '#F59E0B', indigo: '#8B8CF6', teal: '#14B8A6', purple: '#A855F7' };

export const STATUS = {
  'PIP Issued': { bg: 'rgba(244,63,94,0.12)', color: '#F87171', border: 'rgba(244,63,94,0.3)' },
  'PA Issued': { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', border: 'rgba(245,158,11,0.3)' },
  'In Progress': { bg: 'rgba(99,102,241,0.12)', color: '#A5A7FA', border: 'rgba(99,102,241,0.3)' },
  Confirmed: { bg: 'rgba(20,184,166,0.12)', color: '#5EEAD4', border: 'rgba(20,184,166,0.3)' },
};

// Mock dataset — swap for the real RMS/PMS sync (see /api/sync in the PRD build notes).
export const EMP = [
  {
    id: 'EMP4861', name: 'Aarav Mehta', team: 'Sales', manager: 'R. Khanna', doj: '12 Mar 26', tenure: 137,
    status: 'PIP Issued', score: -6.5, issued: '02 Jul 26', due: '02 Aug 26',
    breaches: ['Weekly email missed ×3', 'Negative audit', 'Below satisfactory'],
    v: ['₹0.0L', '₹1.2L', '₹0.4L'], alert: 'Alert',
    signals: [
      { label: 'Weekly email not received (×3)', weight: 'average', pts: '−3.0' },
      { label: 'Negative enquiry audit', weight: 'major', pts: '−2.0' },
      { label: 'Manager feedback below satisfactory', weight: 'average', pts: '−1.0' },
      { label: 'Not on time for meetings', weight: 'major', pts: '−2.0' },
      { label: 'Tech calls attended (4)', weight: 'average', pts: '+1.0' },
      { label: 'Polls participated', weight: 'minor', pts: '+0.5' },
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
      { label: 'Failure in exam', weight: 'major', pts: '−2.0' },
      { label: 'Zero assignments 2 weeks ahead', weight: 'average', pts: '−1.0' },
      { label: 'Weekly email shows less progress', weight: 'major', pts: '−2.0' },
      { label: 'Skills count ≥ weeks since joining', weight: 'average', pts: '+1.0' },
      { label: 'Not replying to HR emails', weight: 'average', pts: '−1.0' },
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
      { label: 'Zero SCs raised', weight: 'average', pts: '−1.0' },
      { label: 'Manager feedback below satisfactory', weight: 'average', pts: '−1.0' },
      { label: 'Audio/video not OK in meetings', weight: 'average', pts: '−1.0' },
      { label: 'Shoddy marked against NJ', weight: 'average', pts: '−1.0' },
      { label: 'Ideas for improvement (2)', weight: 'average', pts: '+0.5' },
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
      { label: 'Shoddy marked against NJ', weight: 'average', pts: '−1.0' },
      { label: 'RMS tasks below cut-off', weight: 'average', pts: '−1.5' },
      { label: 'Process improvements implemented', weight: 'average', pts: '+1.0' },
      { label: 'Applied for KGT', weight: 'average', pts: '+0.5' },
      { label: 'Weekly email not received', weight: 'average', pts: '−1.0' },
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
    status: 'In Progress', score: 1.5, issued: '—', due: '—',
    breaches: ['Feedback pending'], v: ['₹1.4L', '₹3.2L', '₹2.8L'], alert: 'Alert',
    signals: [
      { label: 'Tech calls attended (9)', weight: 'average', pts: '+2.0' },
      { label: 'SCs raised (3)', weight: 'average', pts: '+1.0' },
      { label: 'Manager feedback pending', weight: 'average', pts: '−1.0' },
      { label: 'Not on time for meetings', weight: 'major', pts: '−1.0' },
      { label: 'Polls participated', weight: 'minor', pts: '+0.5' },
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
    status: 'In Progress', score: 3.0, issued: '—', due: '—',
    breaches: [], v: ['61%', '72%', '—'], alert: 'Alert',
    signals: [
      { label: 'TBTs requested (5)', weight: 'average', pts: '+2.0' },
      { label: 'Marking course inhouse', weight: 'minor', pts: '+0.5' },
      { label: 'Skills count ≥ weeks since joining', weight: 'average', pts: '+1.0' },
      { label: 'Weekly email shows less progress', weight: 'major', pts: '−0.5' },
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

export function band(s) {
  if (s <= -4) return { label: 'Critical', color: C.rose };
  if (s <= 0) return { label: 'Low', color: C.amber };
  if (s <= 5) return { label: 'Medium', color: C.indigo };
  return { label: 'Good', color: C.teal };
}

export function decorate(e) {
  const st = STATUS[e.status];
  const b = band(e.score);
  return {
    ...e,
    statusBg: st.bg, statusColor: st.color, statusBorder: st.border,
    bandColor: b.color, bandLabel: b.label,
    scoreStr: (e.score > 0 ? '+' : '') + e.score.toFixed(1),
    short: e.status === 'PIP Issued' ? 'PIP' : e.status === 'PA Issued' ? 'PA' : '—',
  };
}

export const NAV = [
  { label: 'Overview', screen: 'overview', count: '42' },
  { label: 'Sales', screen: 'dept', dept: 'Sales', count: '18' },
  { label: 'Trainer', screen: 'dept', dept: 'Trainer', count: '15' },
  { label: 'PT Team', screen: 'dept', dept: 'PT Team', count: '9' },
  { label: 'PA/PIP Detection', screen: 'papip', count: '6' },
  { label: 'Worry Index', screen: 'worryindex', count: '42' },
  { label: 'Reports', screen: 'reports', count: '2' },
];

export const TITLES = {
  overview: ['Overview', 'God view of every new joiner under Extended Interview'],
  dept: [null, 'Department view · status filters, revenue and feedback columns'],
  papip: ['PA / PIP Detection', 'Every open case, grouped by department'],
  worryindex: ['Worry Index', 'How every signal is scored, and where every NJ lands · 2026-W30'],
  reports: ['Reports', 'Weekly and 15-day reporting'],
};

export const PATHS = (screen, dept) =>
  ({ overview: '/', dept: '/' + dept.toLowerCase().replace(' ', ''), papip: '/papip-detection', worryindex: '/worry-index', reports: '/reports' }[screen]);

export const NOTES_BY = {
  overview: [
    { tag: 'TOTALS', text: 'Three cards, all clickable. Team chips route straight to that department. Worry distribution and overdue feedback are visible before a single click.' },
    { tag: 'REVIEW QUEUE', text: 'Top 5 NJs ranked PIP → PA → In Progress. Row click opens the full employee record — the only place HR needs to go.' },
    { tag: 'PA / PIP PANEL', text: 'Open cases with review dates, scrollable, always in the corner of the eye.' },
  ],
  dept: [
    { tag: 'STATUS CARDS', text: 'Each card filters the table below. Sales gets zero tech calls, negative audits and zero SC; Trainer gets TBTs, assignments and skills.' },
    { tag: 'TABLE', text: 'Search by name or ID, filter by date of joining. Role-specific columns: net revenue for Sales, utilisation for Trainer.' },
    { tag: 'INLINE ACTIONS', text: 'HR notes save on change, Feedback Alert emails the manager, Mark Closed asks for confirmation before flipping status.' },
  ],
  papip: [
    { tag: 'SUMMARY', text: 'Total cases split into PA and PIP so HR sees escalation load at a glance.' },
    { tag: 'DEPARTMENT TABS', text: 'Each tab carries its own case count and filters the table beneath it.' },
    { tag: 'BREACHES', text: 'The parameters that actually caused the case are shown on the row — no drilling required to know why.' },
  ],
  worryindex: [
    { tag: 'BANDS', text: 'Critical, Low, Medium and Good come straight from the cumulative credit score for the week.' },
    { tag: 'SIGNAL TABLE', text: 'Every positive and negative signal that feeds the score, with its weight and which teams it applies to.' },
    { tag: 'PER-EMPLOYEE', text: 'Every NJ scored this week, ranked worst to best, with the same band colour used everywhere else in the app.' },
  ],
  reports: [
    { tag: 'AUTOMATIC', text: 'The weekly report fires on a Vercel cron, Monday 09:00 IST, and needs no HR involvement.' },
    { tag: 'ON DEMAND', text: 'The 15-day report is generated per department when HR needs a snapshot for review meetings.' },
    { tag: 'TRACKING', text: 'Every send and response is logged with an AI rating of the response quality.' },
  ],
};

export const CARD_DEFS = {
  Sales: [['Total', 18, C.purple], ['Not to be Monitored', 6, C.teal], ['Under Watch', 7, C.indigo], ['PA Issued', 2, C.amber], ['PIP Issued', 1, C.rose], ['Zero Tech Calls', 3, '#60A5FA'], ['Negative Audits', 2, '#F472B6']],
  Trainer: [['Total', 15, C.purple], ['Not to be Monitored', 5, C.teal], ['Under Watch', 6, C.indigo], ['PA Issued', 1, C.amber], ['PIP Issued', 1, C.rose], ['Zero TBTs Attended', 4, '#60A5FA'], ['< 2 Skills in 15 days', 3, C.teal]],
  'PT Team': [['Total', 9, C.purple], ['Not to be Monitored', 3, C.teal], ['Under Watch', 4, C.indigo], ['PA Issued', 1, C.amber], ['PIP Issued', 0, C.rose], ['Feedback Pending', 2, '#FB923C'], ['Below Satisfactory', 2, '#F472B6']],
};
export const STATUS_MAP = { 'PA Issued': 'PA Issued', 'PIP Issued': 'PIP Issued' };
export const METRIC_HEADS = { Sales: ['M1 NR', 'M2 NR', 'M3 NR'], Trainer: ['M1 Util', 'M2 Util', 'M3 Util'], 'PT Team': ['Tasks', 'Improve', 'Shoddy'] };

export const WORRY_BANDS = [
  { label: 'Critical', color: C.rose, range: 'score ≤ −4', count: 7, desc: 'PIP review triggered, HR intervenes this week.' },
  { label: 'Low', color: C.amber, range: '−3.5 to 0', count: 11, desc: 'PA candidate. Manager feedback requested early.' },
  { label: 'Medium', color: C.indigo, range: '+0.5 to +5', count: 13, desc: 'Under watch, no action needed yet.' },
  { label: 'Good', color: C.teal, range: '> +5', count: 11, desc: 'On track for confirmation. Not to be monitored.' },
];

export const POS_SIGNALS = [
  { label: 'HR incidents (positive)', teams: 'All', w: '+0.5' },
  { label: 'Polls participated', teams: 'All', w: '+0.5' },
  { label: 'Marking course inhouse', teams: 'Trainer', w: '+0.5' },
  { label: 'Tech calls attended', teams: 'Sales · Trainer', w: '+1' },
  { label: 'SCs raised', teams: 'Sales', w: '+1' },
  { label: 'TBTs requested', teams: 'Trainer', w: '+1' },
  { label: 'Ideas for improvement', teams: 'All', w: '+1' },
  { label: 'Shoddy marked by NJ on others', teams: 'All', w: '+1' },
  { label: 'Skills count ≥ weeks since joining', teams: 'Trainer', w: '+1' },
  { label: 'Applied for KGT', teams: 'All', w: '+1' },
];
export const NEG_SIGNALS = [
  { label: 'Shoddy marked against NJ', teams: 'All', w: '−1' },
  { label: 'Weekly progress email not received', teams: 'All', w: '−1' },
  { label: 'Manager feedback below satisfactory', teams: 'All', w: '−1' },
  { label: 'Not replying to HR emails', teams: 'All', w: '−1' },
  { label: 'Audio / video not OK in meetings', teams: 'All', w: '−1' },
  { label: 'Zero assignments 2 weeks ahead', teams: 'Trainer', w: '−1' },
  { label: 'Weekly email shows less progress', teams: 'All', w: '−2' },
  { label: 'Not on time for meetings', teams: 'All', w: '−2' },
  { label: 'Failure in exam', teams: 'Trainer', w: '−2' },
  { label: 'Negative feedback on delivery', teams: 'Trainer', w: '−2' },
  { label: 'Negative enquiry audit', teams: 'Sales', w: '−2' },
];
export const LOOP = [
  { when: 'MON 09:00', title: 'Progress email goes out', text: 'Every active NJ gets two role-specific questions. Cron-fired, no HR action.' },
  { when: 'MON–EOD', title: 'NJ responds', text: 'Response saved to the DB and forwarded to the HR inbox. No response by EOD applies an auto shoddy.' },
  { when: 'ON SUBMIT', title: 'Acknowledgement sent', text: 'NJ receives confirmation, manager is CC-ed so nothing happens in the dark.' },
  { when: 'WEEK END', title: "Manager rates the week", text: 'Feedback link asks for a rating plus any incomplete commitments.' },
  { when: 'CONTINUOUS', title: 'Worry Index recalculates', text: 'AI classifies response and feedback quality; credit points update the band and trend.' },
];
export const NJ_QUESTIONS = [
  { team: 'Sales', color: '#A5A7FA', q1: 'What were your achievements of last week?', q2: 'How do you plan to increase your pipeline this week?' },
  { team: 'Trainer', color: '#D8B4FE', q1: 'What course did you upgrade to last week?', q2: 'Which course will you upgrade to this week?' },
  { team: 'PT Team', color: '#5EEAD4', q1: 'What did you accomplish last week?', q2: 'Which work will you spend time on this week?' },
];
export const STACK = [
  { k: 'Framework', v: 'Next.js 16.2.2 · App Router' },
  { k: 'Database', v: 'Turso (LibSQL)' },
  { k: 'Email', v: 'MS Graph API · client credentials' },
  { k: 'Hosting', v: 'Vercel · serverless + cron' },
  { k: 'Sources', v: 'RMS · PMS' },
  { k: 'Access', v: 'Internal · HR team only' },
];
export const TABLES = [
  { name: 'employees', note: 'Master record, status, DOJ, manager', color: '#A5A7FA' },
  { name: 'manager_feedback', note: 'd30 / d60 / d90 + AI quality', color: '#A5A7FA' },
  { name: 'pip_status', note: 'PA or PIP, issued and end date', color: '#F87171' },
  { name: 'hr_incidents', note: 'Positive and negative incidents', color: '#F59E0B' },
  { name: 'weekly_responses', note: 'New · questions, answers, AI rating', color: '#5EEAD4' },
  { name: 'trainer_assignments', note: 'Delivery and client feedback', color: '#D8B4FE' },
  { name: 'trainer_skills', note: 'Courses marked, duplicates flagged', color: '#D8B4FE' },
  { name: 'common_index_scores / _summary', note: 'New · weekly points, band, trend', color: '#5EEAD4' },
];
export const ENDPOINTS = [
  { m: 'GET', p: '/api/overview', color: '#5EEAD4' },
  { m: 'GET', p: '/api/employees?category=', color: '#5EEAD4' },
  { m: 'POST', p: '/api/sync', color: '#F59E0B' },
  { m: 'POST', p: '/api/feedback-alert', color: '#F59E0B' },
  { m: 'POST', p: '/api/weekly-report', color: '#F59E0B' },
  { m: 'POST', p: '/api/weekly-response', color: '#F59E0B' },
  { m: 'GET', p: '/api/common-index/summary', color: '#5EEAD4' },
  { m: 'GET', p: '/api/cron/weekly-report', color: '#5EEAD4' },
];
export const RESPONSES = [
  {
    name: 'Aarav Mehta', team: 'Sales', sent: 'Mon 09:00', received: '—', state: 'Overdue',
    bg: 'rgba(244,63,94,0.12)', color: '#F87171', border: 'rgba(244,63,94,0.3)', ai: '—',
    q1: null, a1: null, q2: null, a2: null,
  },
  {
    name: 'Sneha Kapoor', team: 'Trainer', sent: 'Mon 09:00', received: 'Tue 18:40', state: 'Received',
    bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', border: 'rgba(245,158,11,0.3)', ai: 'Low progress',
    q1: 'What course did you upgrade to last week?', a1: 'Still on the Azure fundamentals track, did not move to the next module.',
    q2: 'Which course will you upgrade to this week?', a2: 'Planning to start AZ-104 but waiting on lab access.',
  },
  {
    name: 'Rohit Verma', team: 'Sales', sent: 'Mon 09:00', received: 'Mon 14:02', state: 'Received',
    bg: 'rgba(20,184,166,0.12)', color: '#5EEAD4', border: 'rgba(20,184,166,0.3)', ai: 'Satisfactory',
    q1: 'What were your achievements of last week?', a1: 'Closed one SC worth ₹0.4L and had 3 client discovery calls.',
    q2: 'How do you plan to increase your pipeline this week?', a2: 'Following up with 2 warm leads from the webinar and prospecting 10 new accounts.',
  },
  {
    name: 'Karan Shah', team: 'Sales', sent: 'Mon 09:00', received: 'Mon 10:15', state: 'Received',
    bg: 'rgba(20,184,166,0.12)', color: '#5EEAD4', border: 'rgba(20,184,166,0.3)', ai: 'Above',
    q1: 'What were your achievements of last week?', a1: 'Hit ₹3.2L in net revenue, best week so far. Attended 9 tech calls.',
    q2: 'How do you plan to increase your pipeline this week?', a2: 'Targeting 2 enterprise accounts flagged by the SDR team.',
  },
  {
    name: 'Priya Nair', team: 'PT Team', sent: 'Mon 09:00', received: '—', state: 'Overdue',
    bg: 'rgba(244,63,94,0.12)', color: '#F87171', border: 'rgba(244,63,94,0.3)', ai: '—',
    q1: null, a1: null, q2: null, a2: null,
  },
];
