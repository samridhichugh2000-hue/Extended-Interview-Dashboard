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

function weightCell(weightMap, label) {
  if (!label) return `<td style="padding:5px 8px;background:${WORRY_BG};border-bottom:2px solid #22221E;"></td>`;
  const pts = weightMap.get(label);
  const color = pts > 0 ? '#2F6E5E' : '#B23A2E';
  return `<td style="padding:5px 8px;background:${WORRY_BG};border-bottom:2px solid #22221E;font-weight:700;font-size:11.5px;color:${color};text-align:right;">${fmtPts(pts)}</td>`;
}

function rowSales(e) {
  const calc = calcString(e.signalReport);
  return '<tr>' + [
    cell(e.id, { mono: true }), cell(e.name), cell(e.doj), cell(e.tenure, { right: true }),
    cell(e.techCallsCount, { right: true }), cell(e.scRaised, { right: true }),
    cell(e.negAudits, { right: true }), cell(e.shoddyNegCount, { right: true }), cell(e.shoddyPosCount, { right: true }),
    cell(e.pollsParticipated, { right: true }), scoreCell(e.score), calcCell(calc), cell(e.status),
  ].join('') + '</tr>';
}

function rowTrainer(e) {
  const calc = calcString(e.signalReport);
  return '<tr>' + [
    cell(e.id, { mono: true }), cell(e.name), cell(e.doj), cell(e.tenure, { right: true }),
    cell(e.examFail, { right: true }), cell(e.negFeedback, { right: true }),
    cell(e.assignmentsCount, { right: true }), cell(e.skillsCount, { right: true }),
    cell(e.inHouseSkillsCount, { right: true }), cell(e.techCallsConverted, { right: true }),
    cell(e.tbtCount, { right: true }), cell(e.shoddyNegCount, { right: true }), cell(e.shoddyPosCount, { right: true }),
    cell(e.pollsParticipated, { right: true }), scoreCell(e.score), calcCell(calc), cell(e.status),
  ].join('') + '</tr>';
}

function rowPt(e) {
  const calc = calcString(e.signalReport);
  return '<tr>' + [
    cell(e.id, { mono: true }), cell(e.name), cell(e.doj), cell(e.tenure, { right: true }),
    cell(e.shoddyNegCount, { right: true }), cell(e.shoddyPosCount, { right: true }),
    cell(e.pollsParticipated, { right: true }), scoreCell(e.score), calcCell(calc), cell(e.status),
  ].join('') + '</tr>';
}

export async function buildReport15Html(employees) {
  const { SIGNAL_DEFS } = await import('./data.js');
  const weightMap = new Map(SIGNAL_DEFS.map((d) => [d.label, d.pts]));

  const active = employees.filter((e) => e.active !== false);
  const sales = active.filter((e) => e.team === 'Sales').sort((a, b) => a.score - b.score);
  const trainer = active.filter((e) => e.team === 'Trainer').sort((a, b) => a.score - b.score);
  const pt = active.filter((e) => e.team === 'PT Team').sort((a, b) => a.score - b.score);

  const salesNeg = sales.filter((e) => e.score < 0).length;
  const trainerNeg = trainer.filter((e) => e.score < 0).length;
  const ptNeg = pt.filter((e) => e.score < 0).length;

  const salesHead = [
    th('Emp ID'), th('Name'), th('DOJ'), th('Tenure', { right: true }),
    th('Tech calls', { right: true }), th('SCs raised', { right: true }), th('Neg audits', { right: true }),
    th('Shoddy (neg)', { right: true }), th('Shoddy (pos)', { right: true }), th('Polls', { right: true }),
    th('Worry Index', { right: true }), th('Calculation'), th('Status'),
  ].join('');
  const salesWeights = [
    weightCell(weightMap), weightCell(weightMap), weightCell(weightMap), weightCell(weightMap),
    weightCell(weightMap, 'Tech calls attended'), weightCell(weightMap, 'SCs raised'), weightCell(weightMap, 'Negative enquiry audit'),
    weightCell(weightMap, 'Shoddy marked against NJ'), weightCell(weightMap, 'HR incidents (positive)'), weightCell(weightMap, 'Polls participated'),
    weightCell(weightMap), weightCell(weightMap), weightCell(weightMap),
  ].join('');

  const trainerHead = [
    th('Emp ID'), th('Name'), th('DOJ'), th('Tenure', { right: true }),
    th('Exam fail', { right: true }), th('Neg FB', { right: true }), th('Assign', { right: true }), th('Skills', { right: true }),
    th('Inhouse', { right: true }), th('Tech conv', { right: true }), th('TBTs requested', { right: true }), th('Shoddy (neg)', { right: true }),
    th('Shoddy (pos)', { right: true }), th('Polls', { right: true }), th('Worry Index', { right: true }), th('Calculation'), th('Status'),
  ].join('');
  const trainerWeights = [
    weightCell(weightMap), weightCell(weightMap), weightCell(weightMap), weightCell(weightMap),
    weightCell(weightMap, 'Failure in exam'), weightCell(weightMap, 'Negative feedback on delivery'),
    weightCell(weightMap, 'Zero assignments 2 weeks ahead'), weightCell(weightMap, 'Skills count ≥ weeks since joining'),
    weightCell(weightMap, 'Marking course inhouse'), weightCell(weightMap, 'Tech calls converted'), weightCell(weightMap, 'TBTs requested'),
    weightCell(weightMap, 'Shoddy marked against NJ'), weightCell(weightMap, 'HR incidents (positive)'), weightCell(weightMap, 'Polls participated'),
    weightCell(weightMap), weightCell(weightMap), weightCell(weightMap),
  ].join('');

  const ptHead = [
    th('Emp ID'), th('Name'), th('DOJ'), th('Tenure', { right: true }),
    th('Shoddy (neg)', { right: true }), th('Shoddy (pos)', { right: true }), th('Polls', { right: true }),
    th('Worry Index', { right: true }), th('Calculation'), th('Status'),
  ].join('');
  const ptWeights = [
    weightCell(weightMap), weightCell(weightMap), weightCell(weightMap), weightCell(weightMap),
    weightCell(weightMap, 'Shoddy marked against NJ'), weightCell(weightMap, 'HR incidents (positive)'), weightCell(weightMap, 'Polls participated'),
    weightCell(weightMap), weightCell(weightMap), weightCell(weightMap),
  ].join('');

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
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;">
<tr style="background:#22221E;">${salesHead}</tr>
<tr>${salesWeights}</tr>
${sales.map(rowSales).join('\n')}
</table>
</td></tr>

<tr><td style="padding:24px 32px 8px;">
<div style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#22221E;border-left:6px solid #B5793A;padding-left:12px;">Trainer - ${trainer.length} active NJs, ${trainerNeg} negative</div>
</td></tr>
<tr><td style="padding:0 32px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:11.5px;">
<tr style="background:#22221E;">${trainerHead}</tr>
<tr>${trainerWeights}</tr>
${trainer.map(rowTrainer).join('\n')}
</table>
</td></tr>

<tr><td style="padding:24px 32px 8px;">
<div style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#22221E;border-left:6px solid #2F6E5E;padding-left:12px;">PT Team - ${pt.length} active NJs, ${ptNeg} negative</div>
</td></tr>
<tr><td style="padding:0 32px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;">
<tr style="background:#22221E;">${ptHead}</tr>
<tr>${ptWeights}</tr>
${pt.map(rowPt).join('\n')}
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
