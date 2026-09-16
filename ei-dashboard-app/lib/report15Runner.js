// 15-Day Report — combined Sales/Trainer/PT Team Worry Index snapshot.
// Uses the same live-computed signals/score every employee already carries
// from getEmployees() (see lib/queries.js) — no separate scoring logic here,
// so this can never drift from what the dashboard itself shows.
const WORRY_BG = '#FDF3D9';

function esc(v) {
  if (v === null || v === undefined || v === '') return '—';
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtPts(p) {
  return (p > 0 ? '+' : '') + p;
}

function calcString(signals) {
  const fired = signals.filter((s) => s.status === 'fired');
  if (!fired.length) return 'no signals fired';
  return fired.map((s) => `${fmtPts(s.pts)}(${s.label})`).join(' ');
}

function scoreColor(score) {
  return score < 0 ? '#B23A2E' : '#22221E';
}

// "In Progress" just means "no PA/PIP/Confirmed milestone yet" — the
// default state for most active NJs — so it reads as noise on this report;
// shown as a dash instead of repeating the same status on every other row.
function displayStatus(status) {
  return status === 'In Progress' ? '-' : status;
}

function cell(v, { right, mono } = {}) {
  let style = 'padding:7px 8px;border-bottom:1px solid #ECEAE1;';
  if (right) style += 'text-align:right;';
  if (mono) style += 'font-family:Consolas,monospace;color:#8C8A7F;';
  return `<td style="${style}">${esc(v)}</td>`;
}

function scoreCell(score) {
  return `<td style="padding:7px 8px;border-bottom:1px solid #ECEAE1;text-align:right;font-weight:700;color:${scoreColor(score)};background:${WORRY_BG};">${esc(score)}</td>`;
}

function calcCell(calc) {
  return `<td style="padding:7px 8px;border-bottom:1px solid #ECEAE1;font-size:11px;color:#4A4940;">${esc(calc)}</td>`;
}

function th(label, { right, } = {}) {
  const align = right ? 'text-align:right;' : 'text-align:left;';
  return `<th style="padding:8px;color:#fff;font-size:10.5px;${align}">${label}</th>`;
}

function weightCell(weightMap, label, label2) {
  if (!label) return `<td style="padding:5px 8px;background:${WORRY_BG};border-bottom:2px solid #22221E;"></td>`;
  if (label2) {
    const pts = weightMap.get(label);
    const pts2 = weightMap.get(label2);
    return `<td style="padding:5px 8px;background:${WORRY_BG};border-bottom:2px solid #22221E;font-weight:700;font-size:11.5px;text-align:right;"><span style="color:#B23A2E;">${fmtPts(pts)}</span>/<span style="color:#2F6E5E;">${fmtPts(pts2)}</span></td>`;
  }
  const pts = weightMap.get(label);
  const color = pts > 0 ? '#2F6E5E' : '#B23A2E';
  return `<td style="padding:5px 8px;background:${WORRY_BG};border-bottom:2px solid #22221E;font-weight:700;font-size:11.5px;color:${color};text-align:right;">${fmtPts(pts)}</td>`;
}

// One entry per live Worry Index parameter that has a natural raw metric to
// show (the 4 not-live signals have no data source at all, so they only
// ever appear in the scoring-reference legend below, not as a data column).
// `teams` drives which of Sales/Trainer/PT Team's tables get this column —
// deliberately not just re-reading SIGNAL_DEFS.teams, since Polls
// participated is shown across all three here for visibility even though
// it's excluded from Sales' actual score (see lib/data.js). weightLabels
// keys into SIGNAL_DEFS by label for the weight-reference row; two labels
// render as "neg/pos" (see weightCell) for the paired skills-count signal.
// A factory (not a plain module-level array) because two columns need to
// call back into lib/data.js's missedWeeksCount/belowSatisfactoryCount,
// which are only available once buildReport15Html has imported them.
function buildParamColumns(missedWeeksCount, belowSatisfactoryCount) {
  return [
    { header: 'Tech calls', teams: 'Sales · PT Team', get: (e) => e.techCallsCount, weightLabels: ['Tech calls'] },
    { header: 'SCs raised', teams: 'Sales · PT Team', get: (e) => e.scRaised, weightLabels: ['SCs raised'] },
    { header: 'Neg audits', teams: 'Sales · PT Team', get: (e) => e.negAudits, weightLabels: ['Negative enquiry audit'] },
    { header: 'Tech Calls converted', teams: 'Trainer · PT Team', get: (e) => e.techCallsConverted, weightLabels: ['Tech calls converted'] },
    { header: 'Exams failed', teams: 'Trainer · PT Team', get: (e) => e.examFail, weightLabels: ['Failure in exam'] },
    { header: 'Exams passed', teams: 'Trainer · PT Team', get: (e) => e.examPass, weightLabels: ['Passed exam'] },
    { header: 'Negative Feedback', teams: 'Trainer · PT Team', get: (e) => e.negFeedback, weightLabels: ['Negative feedback on delivery'] },
    { header: 'Assignments (for every week since joining and without assignments, including future)', teams: 'Trainer · PT Team', get: (e) => e.assignmentsCount, weightLabels: ['Zero assignments since joining, including future'] },
    { header: 'Skills Marked', teams: 'Trainer · PT Team', get: (e) => e.skillsCount, weightLabels: ['Skills count < weeks since joining', 'Skills count > weeks since joining'] },
    { header: 'Course marked inhouse', teams: 'Trainer · PT Team', get: (e) => e.inHouseSkillsCount, weightLabels: ['Marking course inhouse'] },
    { header: 'TBTs requested', teams: 'Trainer · PT Team', get: (e) => e.tbtCount, weightLabels: ['TBTs requested'] },
    { header: 'Applied for KGT', teams: 'All', get: (e) => e.kgtCount, weightLabels: ['Applied for KGT'] },
    { header: 'Ideas for improvement', teams: 'All', get: (e) => e.ideasCount, weightLabels: ['Ideas for improvement'] },
    { header: 'Weekly email not received', teams: 'All', get: (e) => missedWeeksCount(e), weightLabels: ['Weekly progress email not received'] },
    { header: 'Manager feedback below satisfactory', teams: 'All', get: (e) => belowSatisfactoryCount(e), weightLabels: ['Manager feedback below satisfactory'] },
    { header: 'Shoddy (neg)', teams: 'All', get: (e) => e.shoddyNegCount, weightLabels: ['Shoddy marked against NJ'] },
    { header: 'Shoddy (pos)', teams: 'All', get: (e) => e.shoddyPosCount, weightLabels: ['HR incidents (positive)'] },
    { header: 'Polls participated', teams: 'All', get: (e) => e.pollsParticipated, weightLabels: ['Polls participated'] },
  ];
}

function buildTeamSection(list, cols, weightMap) {
  const head = [
    th('Emp ID'), th('Name'), th('DOJ'), th('Tenure', { right: true }),
    ...cols.map((c) => th(c.header, { right: true })),
    th('Worry Index', { right: true }), th('Calculation'), th('Status'),
  ].join('');

  const weights = [
    weightCell(weightMap), weightCell(weightMap), weightCell(weightMap), weightCell(weightMap),
    ...cols.map((c) => c.weightLabels.length === 2 ? weightCell(weightMap, c.weightLabels[0], c.weightLabels[1]) : weightCell(weightMap, c.weightLabels[0])),
    weightCell(weightMap), weightCell(weightMap), weightCell(weightMap),
  ].join('');

  const rows = list.map((e) => {
    const calc = calcString(e.signalReport);
    return '<tr>' + [
      cell(e.id, { mono: true }), cell(e.name), cell(e.doj), cell(e.tenure, { right: true }),
      ...cols.map((c) => cell(c.get(e), { right: true })),
      scoreCell(e.score), calcCell(calc), cell(displayStatus(e.status)),
    ].join('') + '</tr>';
  }).join('\n');

  return { head, weights, rows };
}

export async function buildReport15Html(employees) {
  const { SIGNAL_DEFS, appliesToTeam, missedWeeksCount, belowSatisfactoryCount } = await import('./data.js');
  const weightMap = new Map(SIGNAL_DEFS.map((d) => [d.label, d.pts]));

  const active = employees.filter((e) => e.active !== false);
  const sales = active.filter((e) => e.team === 'Sales').sort((a, b) => a.score - b.score);
  const trainer = active.filter((e) => e.team === 'Trainer').sort((a, b) => a.score - b.score);
  const pt = active.filter((e) => e.team === 'PT Team').sort((a, b) => a.score - b.score);

  const salesNeg = sales.filter((e) => e.score < 0).length;
  const trainerNeg = trainer.filter((e) => e.score < 0).length;
  const ptNeg = pt.filter((e) => e.score < 0).length;

  const paramColumns = buildParamColumns(missedWeeksCount, belowSatisfactoryCount);
  const salesCols = paramColumns.filter((c) => appliesToTeam(c.teams, 'Sales'));
  const trainerCols = paramColumns.filter((c) => appliesToTeam(c.teams, 'Trainer'));
  // PT Team's own parameter set is deliberately narrower than the Sales/
  // Trainer columns SIGNAL_DEFS' "· PT Team" tagging would otherwise pull
  // in here — kept to just these three, per HR.
  const PT_COLUMNS = ['Shoddy (neg)', 'Shoddy (pos)', 'Polls participated'];
  const ptCols = paramColumns.filter((c) => PT_COLUMNS.includes(c.header));

  const salesSection = buildTeamSection(sales, salesCols, weightMap);
  const trainerSection = buildTeamSection(trainer, trainerCols, weightMap);
  const ptSection = buildTeamSection(pt, ptCols, weightMap);

  function legendRow(d) {
    const color = d.pts > 0 ? '#2F6E5E' : '#B23A2E';
    const tracked = d.live ? '' : ' <span style="color:#B5793A;font-size:10px;">(not tracked yet)</span>';
    const basis = d.count ? 'per occurrence' : 'flat, if condition met';
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #ECEAE1;">${esc(d.label)}${tracked}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #ECEAE1;color:#8C8A7F;">${esc(d.teams)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #ECEAE1;text-align:right;font-weight:700;color:${color};">${fmtPts(d.pts)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #ECEAE1;color:#8C8A7F;font-size:11px;">${basis}</td>
    </tr>`;
  }
  const legendRows = SIGNAL_DEFS.map(legendRow).join('\n');

  const today = new Date().toISOString().slice(0, 10);

  return `<div style="background:#F7F5F0;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:1180px;margin:0 auto;background:#FFFFFE;border:1px solid #DAD6CB;">

<tr><td style="padding:28px 32px 20px;border-bottom:2px solid #22221E;">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#22221E;font-weight:700;letter-spacing:-0.01em;">15-Day Report — Sales, Trainer, PT Team</div>
<div style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:#6B6A63;margin-top:6px;">Extended Interview dashboard - ${today} - every active NJ per department, computed live via the app's own Worry Index scoring engine, sorted lowest score first</div>
</td></tr>

<tr><td style="padding:16px 32px 4px;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#8C8A7F;background:#F0EEE5;border:1px solid #DAD6CB;padding:10px 14px;line-height:1.6;">
Sales: ${salesNeg} of ${sales.length} negative - Trainer: ${trainerNeg} of ${trainer.length} negative - PT Team: ${ptNeg} of ${pt.length} negative. "Calculation" shows only the parameters that fired (counted toward the score).
</div>
</td></tr>

<tr><td style="padding:24px 32px 8px;">
<div style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#22221E;border-left:6px solid #B23A2E;padding-left:12px;">Sales - ${sales.length} active NJs, ${salesNeg} negative</div>
</td></tr>
<tr><td style="padding:0 32px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:11px;">
<tr style="background:#22221E;">${salesSection.head}</tr>
<tr>${salesSection.weights}</tr>
${salesSection.rows}
</table>
</td></tr>

<tr><td style="padding:24px 32px 8px;">
<div style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#22221E;border-left:6px solid #B5793A;padding-left:12px;">Trainer - ${trainer.length} active NJs, ${trainerNeg} negative</div>
</td></tr>
<tr><td style="padding:0 32px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:11px;">
<tr style="background:#22221E;">${trainerSection.head}</tr>
<tr>${trainerSection.weights}</tr>
${trainerSection.rows}
</table>
</td></tr>

<tr><td style="padding:24px 32px 8px;">
<div style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#22221E;border-left:6px solid #2F6E5E;padding-left:12px;">PT Team - ${pt.length} active NJs, ${ptNeg} negative</div>
</td></tr>
<tr><td style="padding:0 32px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:11px;">
<tr style="background:#22221E;">${ptSection.head}</tr>
<tr>${ptSection.weights}</tr>
${ptSection.rows}
</table>
</td></tr>

<tr><td style="padding:24px 32px 8px;">
<div style="font-family:Georgia,serif;font-size:16px;font-weight:700;color:#22221E;">Scoring reference &mdash; weight per parameter</div>
<div style="font-family:Arial,sans-serif;font-size:11px;color:#8C8A7F;margin-top:2px;">Each fired signal contributes its weight to the Worry Index. "Per occurrence" signals multiply by the real count (e.g. 9 SCs raised = +9); "flat" signals apply their full weight once if the condition is met, regardless of count.</div>
</td></tr>
<tr><td style="padding:8px 32px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12.5px;">
<tr style="background:#22221E;">
<th style="padding:7px 8px;text-align:left;color:#fff;font-size:10.5px;">Parameter</th>
<th style="padding:7px 8px;text-align:left;color:#fff;font-size:10.5px;">Applies to</th>
<th style="padding:7px 8px;text-align:right;color:#fff;font-size:10.5px;">Weight</th>
<th style="padding:7px 8px;text-align:left;color:#fff;font-size:10.5px;">Basis</th>
</tr>
${legendRows}
</table>
</td></tr>

<tr><td style="padding:16px 32px 28px;">
<div style="font-family:Arial,sans-serif;font-size:11px;color:#8C8A7F;border-top:1px solid #DAD6CB;padding-top:14px;">
Generated from live dashboard data on ${today}. Scores computed via the app's own SIGNAL_DEFS scoring engine (lib/data.js) applied to each employee's real synced signal data.
</div>
</td></tr>

</table>
</div>`;
}

const REPORT15_RECIPIENT = 'samridhi.chugh@koenig-solutions.com';

export async function sendReport15() {
  const { getEmployees } = await import('./queries.js');
  const { sendMail } = await import('./graphMailer.js');

  const employees = await getEmployees();
  const html = await buildReport15Html(employees);
  const today = new Date().toISOString().slice(0, 10);

  await sendMail({
    to: REPORT15_RECIPIENT,
    subject: `15-Day Report - Sales, Trainer, PT Team - ${today}`,
    html,
  });

  return { message: `15-Day Report sent to ${REPORT15_RECIPIENT}.` };
}
