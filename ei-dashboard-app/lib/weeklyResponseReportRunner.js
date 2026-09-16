import { getDb } from './db';

const RECIPIENT = 'Samridhi.chugh@koenig-solutions.com';

function shoddyMarkedEmailHtml({ name }) {
  return `
    <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">
      <p>Hi ${name}</p>
      <p>This is for your information.</p>
      <p>Remark : Missed the weekly NJ Check-In. Please note that submitting the response through the provided link is mandatory.</p>
      <p>You are receiving this email because a Shoddy has been marked for you.</p>
      <p>Marked by: HR Team</p>
      <p>Regards,<br/>Team HR</p>
    </div>`;
}

// Runs mid-week (Wednesday) against the same ISO week Monday's weekly
// check-in email went out for, so it reports on responses received so far —
// not a closed-out week. Every active NJ appears exactly once, whether they
// responded or not, so the "missed it" list is a byproduct of one full
// table rather than a second query.
export async function sendWeeklyResponseReport() {
  const db = getDb();
  const { getIsoWeek, istDateKey } = await import('./weekUtils.js');
  const { sendMail } = await import('./graphMailer.js');
  const { getManagerEmail } = await import('./managerDirectory.js');
  const { markIncident } = await import('./koenigMarkIncidentApi.js');
  const ExcelJS = (await import('exceljs')).default;

  const week = getIsoWeek(new Date());

  const employees = await db.execute(
    "SELECT id, name, email, team, manager FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1 ORDER BY team ASC, name ASC"
  );
  const responses = await db.execute({ sql: 'SELECT * FROM weekly_responses WHERE week = ?', args: [week] });
  const byEmp = new Map(responses.rows.map((r) => [r.employee_id, r]));

  // Anyone who got the check-in email (a weekly_responses row exists) but
  // hasn't submitted by the time this runs gets a shoddy marked with Koenig —
  // the same warning the initial email gave them. shoddy_marked_at guards
  // against double-marking if this job is ever re-run for the same week.
  // The 48-hour grace period is normally covered just by this job running
  // Wednesday against a Monday send, but a late-added NJ can get their
  // first check-in email sent same-day as this run (weeklyreport is a daily
  // cron) — skip those this cycle rather than marking them with ~0 hours'
  // notice; they'll be picked up next week if still unresponsive.
  const todayIst = istDateKey(new Date());
  const reportedDate = new Date().toISOString().slice(0, 10);
  const shoddyMarked = [];
  const shoddyFailed = [];
  for (const emp of employees.rows) {
    const r = byEmp.get(emp.id);
    if (!r || r.state === 'Received' || r.shoddy_marked_at) continue;
    if (r.sent_at && istDateKey(new Date(r.sent_at)) === todayIst) continue;

    try {
      const incident = await markIncident({
        empId: emp.id.replace('EMP', ''),
        reportedDate,
        reason: `No response to weekly NJ check-in for ${week}`,
      });
      await db.execute({
        sql: 'UPDATE weekly_responses SET shoddy_marked_at = ?, shoddy_incident_id = ? WHERE id = ?',
        args: [new Date().toISOString(), incident?.IncidentId ?? null, r.id],
      });
      r.shoddy_marked_at = new Date().toISOString();
      shoddyMarked.push(emp.name);

      // Best-effort — the incident is already recorded with Koenig by this
      // point, so a Graph hiccup here shouldn't be reported as a marking
      // failure (that would wrongly suggest a retry is needed/safe).
      if (emp.email) {
        try {
          await sendMail({
            to: emp.email,
            cc: getManagerEmail(emp.manager),
            subject: 'Shoddy incident notification',
            html: shoddyMarkedEmailHtml({ name: emp.name }),
          });
        } catch (err) {
          console.error(`Shoddy notification email failed for ${emp.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error(`markIncident failed for ${emp.id}:`, err.message);
      shoddyFailed.push(emp.name);
    }
  }

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
    { header: 'Shoddy Marked', key: 'shoddyMarked', width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };

  let received = 0;
  const missed = [];
  for (const emp of employees.rows) {
    const r = byEmp.get(emp.id);
    const status = !r ? 'Not sent' : r.state === 'Received' ? 'Received' : 'Pending';
    if (status === 'Received') received++;
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
      shoddyMarked: r?.shoddy_marked_at ? 'Yes' : '—',
    });
    if (status !== 'Received') {
      row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const total = employees.rows.length;
  const dateLabel = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  await sendMail({
    to: RECIPIENT,
    subject: `Weekly NJ Response Report - ${dateLabel}`,
    html: `
      <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">
        <p>Weekly NJ check-in status for ${week}, as of today.</p>
        <p><strong>${received}</strong> of <strong>${total}</strong> active NJs have responded.</p>
        ${missed.length ? `<p style="color:#B91C1C;font-weight:600;">Missed (${missed.length}): ${missed.join(', ')}</p>` : '<p>Everyone has responded so far.</p>'}
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

  return { message: `Sent weekly response report for ${week}: ${received} of ${total} active NJs responded, ${missed.length} missed, ${shoddyMarked.length} shoddy marked${shoddyFailed.length ? `, ${shoddyFailed.length} shoddy marking FAILED` : ''}.` };
}
