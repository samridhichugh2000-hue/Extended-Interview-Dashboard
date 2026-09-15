import { NextResponse } from 'next/server';
import { sendMail } from '../../../../../lib/graphMailer';
import { getDb } from '../../../../../lib/db';

export const dynamic = 'force-dynamic';

const HR_CC = 'HR@koenig-solutions.com';
const PIP_STATUS = { PA: 'PA Issued', PIP: 'PIP Issued' };
const PIP_SUBJECT = { PA: 'Performance Alert – Extended Interview', PIP: 'Performance Improvement Plan – Extended Interview' };

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDeadline(deadline) {
  if (!deadline) return '[Deadline Date]';
  const d = new Date(`${deadline}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function alertEmailHtml({ name, signals, metric, deadline }) {
  const list = (signals || []).map((s) => `<li>${esc(s.label)}: ${esc(s.value)}</li>`).join('');
  const table = metric
    ? `<table style="border-collapse:collapse;margin:0 0 12px;font-size:13px;">
        <thead><tr>${metric.months.map((m) => `<th style="border:1px solid #ccc;padding:5px 9px;background:#f5f5f5;">${esc(m.head)}</th>`).join('')}</tr></thead>
        <tbody><tr>${metric.months.map((m) => `<td style="border:1px solid #ccc;padding:5px 9px;">${metric.isCurrency && m.value !== '—' && m.value != null ? '₹' + esc(m.value) : esc(m.value)}</td>`).join('')}</tr></tbody>
      </table>`
    : '';
  return `
    <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">
      <p>Hi ${esc(name)},</p>
      <p>This is to formally bring to your attention certain performance related concerns that require immediate attention.</p>
      <p style="margin-bottom:4px;">The following concerns have been noted:</p>
      ${list ? `<ul>${list}</ul>` : '<p>None selected.</p>'}
      ${table}
      <p>You are expected to demonstrate immediate and sustained improvement in the above areas.</p>
      <p>The required improvement is expected to be demonstrated by <b>${esc(fmtDeadline(deadline))}</b>.</p>
      <p>Your performance will be reviewed during this period, and further action may be taken based on the outcome of the review.</p>
      <p>Regards,<br/>Team HR</p>
    </div>`;
}

// Fired from the "Alert" action on the Dept table row and the EmployeeModal's
// "Send feedback alert" chip, shown once an NJ's Worry Index hits the
// Critical band (score <= -4, see lib/data.js band()). Opens a preview
// (AlertPreviewModal in DashboardClient.js) where HR picks a PA or PIP, a
// deadline, and which tracked parameters/month-wise metric to cite before
// saving — `signals` is [{label, value}] (real occurrence counts, not
// points), `metric` is the Month-wise NR/Utilization table if kept checked.
// Sent from the app's default sender mailbox (GRAPH_SENDER_EMAIL, currently
// samridhi.chugh@koenig-solutions.com), CC'd to HR@koenig-solutions.com for
// visibility. Sending as HR@koenig-solutions.com directly was attempted
// (lib/graphMailer.js's `from` override supports it) but Graph 404s on that
// address — "HR@koenig-solutions.com" doesn't resolve as a mail-enabled
// object via /users at all (confirmed independent of sendMail), so it's
// likely a distribution list/M365 Group rather than a shared mailbox, or the
// address on file is wrong. Revisit once that's sorted — swap back to
// `from: 'HR@koenig-solutions.com'` and drop the cc. Saving also flips
// employees.status to match (PA Issued / PIP Issued), same status field the
// Dept/Overview screens already key off (see close/route.js). It does NOT
// yet call the PIP API that will push this to RMS — that endpoint hasn't
// been provided; wire it in here once it exists (data to send: employee
// id/name, pipType, deadline, signals, metric).
export async function POST(request, { params }) {
  const { id } = params;
  const body = await request.json().catch(() => null);
  const { name, email, signals, metric, pipType, deadline } = body || {};
  if (!email) {
    return NextResponse.json({ ok: false, error: 'No email on file for this employee.' }, { status: 400 });
  }
  if (!PIP_STATUS[pipType]) {
    return NextResponse.json({ ok: false, error: 'Select PA or PIP before saving.' }, { status: 400 });
  }
  if (!deadline) {
    return NextResponse.json({ ok: false, error: 'Select a deadline date before saving.' }, { status: 400 });
  }
  try {
    await sendMail({
      to: email,
      cc: HR_CC,
      subject: PIP_SUBJECT[pipType],
      html: alertEmailHtml({ name, signals, metric, deadline }),
    });
    const db = getDb();
    const res = await db.execute({ sql: 'UPDATE employees SET status = ? WHERE id = ?', args: [PIP_STATUS[pipType], id] });
    if (res.rowsAffected === 0) {
      return NextResponse.json({ ok: false, error: `Email sent, but no employee found with id ${id} to update status.` }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
