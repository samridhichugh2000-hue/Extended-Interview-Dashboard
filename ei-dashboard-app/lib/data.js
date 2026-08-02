export const C = { rose: '#F43F5E', amber: '#F59E0B', indigo: '#8B8CF6', teal: '#14B8A6', purple: '#A855F7' };

export const STATUS = {
  'PIP Issued': { bg: 'rgba(244,63,94,0.12)', color: '#F87171', border: 'rgba(244,63,94,0.3)' },
  'PA Issued': { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', border: 'rgba(245,158,11,0.3)' },
  'In Progress': { bg: 'rgba(99,102,241,0.12)', color: '#A5A7FA', border: 'rgba(99,102,241,0.3)' },
  Confirmed: { bg: 'rgba(20,184,166,0.12)', color: '#5EEAD4', border: 'rgba(20,184,166,0.3)' },
};

export function band(s) {
  if (s <= -4) return { label: 'Critical', color: C.rose };
  if (s <= 0) return { label: 'Low', color: C.amber };
  if (s <= 5) return { label: 'Medium', color: C.indigo };
  return { label: 'Good', color: C.teal };
}

export function decorate(e) {
  const st = STATUS[e.status];
  const b = band(e.score);
  const inactive = e.active === false;
  return {
    ...e,
    statusBg: inactive ? 'rgba(255,255,255,0.06)' : st.bg,
    statusColor: inactive ? '#6E7488' : st.color,
    statusBorder: inactive ? 'rgba(255,255,255,0.12)' : st.border,
    bandColor: inactive ? '#6E7488' : b.color,
    bandLabel: inactive ? 'Inactive' : b.label,
    scoreStr: (e.score > 0 ? '+' : '') + e.score.toFixed(1),
    short: e.status === 'PIP Issued' ? 'PIP' : e.status === 'PA Issued' ? 'PA' : '—',
    inactive,
    rowStyle: inactive ? { opacity: 0.45, filter: 'grayscale(0.6)' } : undefined,
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
export const METRIC_HEADS = { Sales: ['M1 NR', 'M2 NR', 'M3 NR', 'M4 NR', 'M5 NR', 'M6 NR'], Trainer: ['M1 Util', 'M2 Util', 'M3 Util', 'M4 Util', 'M5 Util', 'M6 Util'], 'PT Team': ['Tasks', 'Improve'] };

export const WORRY_BANDS = [
  { label: 'Critical', color: C.rose, range: 'score ≤ −4', desc: 'PIP review triggered, HR intervenes this week.' },
  { label: 'Low', color: C.amber, range: '−3.5 to 0', desc: 'PA candidate. Manager feedback requested early.' },
  { label: 'Medium', color: C.indigo, range: '+0.5 to +5', desc: 'Under watch, no action needed yet.' },
  { label: 'Good', color: C.teal, range: '> +5', desc: 'On track for confirmation. Not to be monitored.' },
];

// Single source of truth for the Worry Index scoring model. `live: true` means
// a real synced field backs the signal, so it's actually counted in the score;
// `live: false` signals have no data source yet (no weekly-email, HR-incident,
// manager-feedback or polls/KGT tracking built) and are excluded from scoring
// until that plumbing exists — shown in the reference table as "not tracked".
// `hasData` tells apart a genuine, confirmed reading (e.g. 0 tech calls, the
// API really returned none) from a field that was never synced for this NJ
// (null/undefined) — the two look identical as "didn't fire" otherwise, and
// the whole point of tracking this is telling HR which is which.
export const SIGNAL_DEFS = [
  // positive, live
  { label: 'Tech calls attended', teams: 'Sales', pts: 1, live: true,
    hasData: (e) => e.techCallsCount != null,
    fires: (e) => e.techCallsCount > 0 },
  { label: 'Tech calls converted', teams: 'Trainer', pts: 1, live: true,
    hasData: (e) => e.techCallsConverted != null,
    fires: (e) => e.techCallsConverted > 0 },
  { label: 'SCs raised', teams: 'Sales', pts: 1, live: true,
    hasData: (e) => e.scRaised != null,
    fires: (e) => e.scRaised > 0 },
  { label: 'TBTs requested', teams: 'Trainer', pts: 1, live: true,
    hasData: (e) => e.tbtCount != null,
    fires: (e) => e.tbtCount > 0 },
  // Sourced from Koenig's incident feed (lib/koenigShoddyApi.js) — despite the
  // "shoddy" naming on that module, its positive-nature records are HR
  // incidents logged in the NJ's favor, not specifically about catching
  // someone else's shoddy work. "Shoddy marked by NJ on others" was a mislabel
  // of the same data and has been folded into this signal rather than double-
  // counted separately.
  { label: 'HR incidents (positive)', teams: 'All', pts: 1, live: true,
    hasData: (e) => e.shoddyPosCount != null,
    fires: (e) => e.shoddyPosCount > 0 },
  { label: 'Skills count ≥ weeks since joining', teams: 'Trainer', pts: 1, live: true,
    hasData: (e) => e.skillsCount != null,
    fires: (e) => { const wks = Math.floor((e.tenure ?? 0) / 7); return wks > 0 && (e.skillsCount ?? 0) >= wks; } },
  // Sourced from the standalone Polls Dashboard API (lib/pollsApi.js), matched
  // by email. Null means that email has no record on the polls dashboard at
  // all — distinct from a confirmed 0 participation count.
  { label: 'Polls participated', teams: 'All', pts: 0.5, live: true,
    hasData: (e) => e.pollsParticipated != null,
    fires: (e) => e.pollsParticipated > 0 },
  // positive, not yet tracked — no data source exists for these at all
  { label: 'Marking course inhouse', teams: 'Trainer', pts: 0.5, live: false, hasData: () => false, fires: () => false },
  { label: 'Ideas for improvement', teams: 'All', pts: 1, live: false, hasData: () => false, fires: () => false },
  { label: 'Applied for KGT', teams: 'All', pts: 1, live: false, hasData: () => false, fires: () => false },
  // negative, live
  { label: 'Shoddy marked against NJ', teams: 'All', pts: -1, live: true,
    hasData: (e) => e.shoddyNegCount != null,
    fires: (e) => e.shoddyNegCount > 0 },
  { label: 'Zero assignments 2 weeks ahead', teams: 'Trainer', pts: -1, live: true,
    hasData: (e) => e.assignmentsCount != null,
    fires: (e) => (e.tenure ?? 0) >= 14 && !e.assignmentsCount },
  { label: 'Failure in exam', teams: 'Trainer', pts: -2, live: true,
    hasData: (e) => e.examFail != null,
    fires: (e) => e.examFail > 0 },
  { label: 'Negative feedback on delivery', teams: 'Trainer', pts: -2, live: true,
    hasData: (e) => e.negFeedback != null,
    fires: (e) => e.negFeedback > 0 },
  { label: 'Negative enquiry audit', teams: 'Sales', pts: -2, live: true,
    hasData: (e) => e.negAudits != null,
    fires: (e) => e.negAudits > 0 },
  // negative, not yet tracked
  { label: 'Weekly progress email not received', teams: 'All', pts: -1, live: false, hasData: () => false, fires: () => false },
  { label: 'Manager feedback below satisfactory', teams: 'All', pts: -1, live: false, hasData: () => false, fires: () => false },
  { label: 'Not replying to HR emails', teams: 'All', pts: -1, live: false, hasData: () => false, fires: () => false },
  { label: 'Audio / video not OK in meetings', teams: 'All', pts: -1, live: false, hasData: () => false, fires: () => false },
  { label: 'Weekly email shows less progress', teams: 'All', pts: -2, live: false, hasData: () => false, fires: () => false },
  { label: 'Not on time for meetings', teams: 'All', pts: -2, live: false, hasData: () => false, fires: () => false },
];

function fmtPts(n) {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return sign + (Math.abs(n) % 1 === 0 ? Math.abs(n).toFixed(0) : Math.abs(n).toFixed(1));
}
function weightClass(n) {
  const a = Math.abs(n);
  return a <= 0.5 ? 'minor' : a === 1 ? 'average' : 'major';
}
export function appliesToTeam(teams, team) {
  return teams === 'All' || teams.split(' · ').includes(team);
}

export const POS_SIGNALS = SIGNAL_DEFS.filter((d) => d.pts > 0).map((d) => ({ label: d.label, teams: d.teams, w: fmtPts(d.pts), live: d.live }));
export const NEG_SIGNALS = SIGNAL_DEFS.filter((d) => d.pts < 0).map((d) => ({ label: d.label, teams: d.teams, w: fmtPts(d.pts), live: d.live }));

// Every parameter that applies to this employee's team, whichever way it
// landed — this is the "each and every parameter" view, not just the ones
// that fired. status is one of:
//   'fired'       — live, has data, condition true — counts toward the score
//   'clear'       — live, has data, condition false — a confirmed non-event
//   'no-data'     — live signal, but this NJ has no synced value for it yet
//   'not-tracked' — no data source exists for this signal at all
export function computeSignalReport(e) {
  return SIGNAL_DEFS
    .filter((d) => appliesToTeam(d.teams, e.team))
    .map((d) => {
      const status = !d.live ? 'not-tracked' : !d.hasData(e) ? 'no-data' : d.fires(e) ? 'fired' : 'clear';
      return { label: d.label, pts: d.pts, ptsStr: fmtPts(d.pts), weight: weightClass(d.pts), status };
    });
}
// Only fired signals feed the actual score.
export function computeWorrySignals(e) {
  return computeSignalReport(e).filter((s) => s.status === 'fired');
}
export function computeWorryScore(signals) {
  return Math.round(signals.reduce((sum, s) => sum + s.pts, 0) * 10) / 10;
}
export function trendNoteFor(signals) {
  if (!signals.length) return 'No live signals recorded yet — score reflects only tracked data sources.';
  const pos = signals.filter((s) => s.pts > 0).length;
  const neg = signals.filter((s) => s.pts < 0).length;
  const parts = [];
  if (pos) parts.push(`${pos} positive`);
  if (neg) parts.push(`${neg} negative`);
  return `${parts.join(', ')} signal${signals.length > 1 ? 's' : ''} this week.`;
}
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
