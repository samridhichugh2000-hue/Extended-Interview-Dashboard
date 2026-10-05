import { getDb } from './db.js';

const RECIPIENT = 'Samridhi.chugh@koenig-solutions.com';

// Runs mid-week (Wednesday) against the same ISO week Monday's weekly
// check-in email went out for, so it reports on responses received so far —
// not a closed-out week. Every active NJ appears exactly once, whether they
// responded or not, so the "missed it" list is a byproduct of one full
// table rather than a second query.
//
// Auto shoddy-marking is PAUSED — do not re-enable without explicit sign-off.
// This job used to also loop every non-responder through markIncident()
// (raising a real Koenig HR incident) plus a "Shoddy incident notification"
// email, both fully automated off nothing more than a missed check-in reply.
// shoddyMarked/shoddyFailed stay hardcoded empty below so the report still
// renders correctly, just always reporting zero auto-marked.
export async function sendWeeklyResponseReport() {
  const db = getDb();
  const { getIsoWeek } = await import('./weekUtils.js');
  const { sendMail } = await import('./graphMailer.js');
  const { getManagerEmail } = await import('./managerDirectory.js');
  const ExcelJS = (await import('exceljs')).default;

  const week = getIsoWeek(new Date());

  const employees = await db.execute(
    "SELECT id, name, email, team, manager, status AS pa_pip_status, tenure_days, rc_fully_booked_week, rc_fully_booked_sc_hours FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1 ORDER BY team ASC, name ASC"
  );
  const responses = await db.execute({ sql: 'SELECT * FROM weekly_responses WHERE week = ?', args: [week] });
  const byEmp = new Map(responses.rows.map((r) => [r.employee_id, r]));

  const shoddyMarked = [];
  const shoddyFailed = [];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Week ${week}`);
  sheet.columns = [
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Team', key: 'team', width: 12 },
    { header: 'Manager', key: 'manager', width: 22 },
    { header: 'Manager Email', key: 'managerEmail', width: 32 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Sent At', key: 'sentAt', width: 20 },
    { header: 'Received At', key: 'receivedAt', width: 20 },
    { header: 'Q1', key: 'q1', width: 32 },
    { header: 'A1', key: 'a1', width: 40 },
    { header: 'Q2', key: 'q2', width: 32 },
    { header: 'A2', key: 'a2', width: 40 },
    { header: 'AI Rating', key: 'aiRating', width: 12 },
    { header: 'Reason for Rating', key: 'aiReason', width: 40 },
    { header: 'Shoddy Marked', key: 'shoddyMarked', width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };

  let received = 0;
  const missed = [];
  const skipped = [];
  for (const emp of employees.rows) {
    const r = byEmp.get(emp.id);
    // Trainers on 40+ SC hours this week are deliberately not sent a check-in
    // (see excludeFullyBookedTrainers) — listed as SKIPPED, not "missed".
    // Only trainers who'd otherwise have been sent one (NJ or PA/PIP) — other
    // fully-booked trainers were never due a check-in.
    const dueCheckIn = emp.tenure_days < 182 || ['PA Issued', 'PIP Issued'].includes(emp.pa_pip_status);
    const fullyBooked = !r && dueCheckIn && emp.team === 'Trainer' && emp.rc_fully_booked_week === week
      && (emp.rc_fully_booked_sc_hours || 0) >= 40;
    const status = fullyBooked ? 'SKIPPED' : !r ? 'Not sent' : r.state === 'Received' ? 'Received' : 'Pending';
    if (status === 'Received') received++;
    else if (status === 'SKIPPED') skipped.push(`${emp.name} (${emp.rc_fully_booked_sc_hours} SC hrs)`);
    else missed.push(emp.name);

    const row = sheet.addRow({
      name: emp.name,
      team: emp.team,
      manager: emp.manager,
      managerEmail: getManagerEmail(emp.manager) || '—',
      status,
      sentAt: r?.sent_at || '—',
      receivedAt: r?.received_at || '—',
      q1: r?.q1 || '—',
      a1: r?.a1 || '—',
      q2: r?.q2 || '—',
      a2: r?.a2 || '—',
      aiRating: r?.ai_rating || '—',
      aiReason: r?.ai_rating_reason || '—',
      shoddyMarked: r?.shoddy_marked_at ? 'Yes' : '—',
    });
    if (status === 'SKIPPED') {
      row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
      row.getCell('q1').value = `SKIPPED — ${emp.rc_fully_booked_sc_hours} SC hours this week (in a 40-hour batch)`;
    } else if (status !== 'Received') {
      row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const total = employees.rows.length - skipped.length;
  const dateLabel = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  await sendMail({
    to: RECIPIENT,
    subject: `Weekly NJ Response Report - ${dateLabel}`,
    html: `
      <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">
        <p>Weekly NJ check-in status for ${week}, as of today.</p>
        <p><strong>${received}</strong> of <strong>${total}</strong> active NJs have responded.</p>
        ${missed.length ? `<p style="color:#B91C1C;font-weight:600;">Missed (${missed.length}): ${missed.join(', ')}</p>` : '<p>Everyone has responded so far.</p>'}
        ${skipped.length ? `<p style="color:#92400E;font-weight:600;">SKIPPED (${skipped.length}) — 40+ SC hours this week, not sent a check-in: ${skipped.join(', ')}</p>` : ''}
        ${shoddyMarked.length ? `<p style="color:#B91C1C;font-weight:600;">Shoddy marked (${shoddyMarked.length}): ${shoddyMarked.join(', ')}</p>` : ''}
        ${shoddyFailed.length ? `<p style="color:#B91C1C;font-weight:600;">Shoddy marking FAILED for (${shoddyFailed.length}) — needs manual follow-up: ${shoddyFailed.join(', ')}</p>` : ''}
        <p>Full breakdown with questions/answers attached.</p>
      </div>`,
    attachments: [{
      name: `Weekly_NJ_Response_Report_${week}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: Buffer.from(buffer).toString('base64'),
    }],
  });

  return { message: `Sent weekly response report for ${week}: ${received} of ${total} active NJs responded, ${missed.length} missed, ${skipped.length} skipped (40+ SC hours), ${shoddyMarked.length} shoddy marked${shoddyFailed.length ? `, ${shoddyFailed.length} shoddy marking FAILED` : ''}.` };
}
