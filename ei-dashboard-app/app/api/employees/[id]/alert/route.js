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

function alertEmailHtml({ name, signals, metric, deadline, note }) {
  const list = (signals || []).map((s) => `<li>${esc(s.label)}: ${esc(s.value)}</li>`).join('');
  const table = metric
    ? `<table style="border-collapse:collapse;margin:0 0 12px;font-size:13px;">
        <thead><tr>${metric.months.map((m) => `<th style="border:1px solid #ccc;padding:5px 9px;background:#f5f5f5;">${esc(m.head)}</th>`).join('')}</tr></thead>
        <tbody><tr>${metric.months.map((m) => `<td style="border:1px solid #ccc;padding:5px 9px;">${metric.isCurrency && m.value !== '—' && m.value != null ? '₹' + esc(m.value) : esc(m.value)}</td>`).join('')}</tr></tbody>
      </table>`
    : '';
  // note is a free-text addition HR typed into the draft (AlertPreviewModal)
  // for anything the checked parameters above don't cover — whitespace
  // (including line breaks) preserved via white-space:pre-wrap since it's
  // plain text, not HTML, from the user.
  const noteBlock = note ? `<p style="white-space:pre-wrap;">${esc(note)}</p>` : '';
  return `
    <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">
      <p>Hi ${esc(name)},</p>
      <p>This is to formally bring to your attention certain performance related concerns that require immediate attention.</p>
      <p style="margin-bottom:4px;">The following concerns have been noted:</p>
      ${list ? `<ul>${list}</ul>` : '<p>None selected.</p>'}
      ${table}
      ${noteBlock}
      <p>You are expected to demonstrate immediate and sustained improvement in the above areas.</p>
      <p>The required improvement is expected to be demonstrated by <b>${esc(fmtDeadline(deadline))}</b>.</p>
      <p>Your performance will be reviewed during this period, and further action may be taken based on the outcome of the review.</p>
      <p>Regards,<br/>Team HR</p>
    </div>`;
}

// Posts an issued PA/PIP to RMS (Koenig's own system of record) — the API
// endpoint for this hasn't been provided yet. No-op stub until then; once
// it exists, replace the body with the real call using this exact payload
// (employee id/name, pipType, deadline, the parameters HR actually chose to
// cite, and any free-text note) — everything RMS would need is already
// assembled right here. Called for every PA/PIP issued from this route,
// which is the single path both the Worry Index "Send feedback alert" flow
// and the PA Algo screen's "Issue PA/PIP" button go through (both open the
// same AlertPreviewModal), so wiring it here covers both entry points at
// once. Deliberately best-effort/non-fatal — a future RMS outage or bug
// here should never block the email + local status update from succeeding.
async function postPaPipToRms(payload) {
  console.log('RMS posting not yet wired up (no API provided) — would have posted:', JSON.stringify(payload));
}

// Fired from the "Alert" action on the Dept table row, the EmployeeModal's
// "Send feedback alert" chip (shown once an NJ's Worry Index hits the
// Critical band — score <= -4, see lib/data.js band()), and the
// EmployeeModal's "Issue PA/PIP" chip (any active employee, not gated on
// Worry Index band — this is how PA Algo candidates get issued in
// practice). All three open the same preview (AlertPreviewModal in
// DashboardClient.js) where HR picks a PA or PIP, a deadline, which tracked
// parameters/month-wise metric to cite, and an optional free-text note,
// before saving — `signals` is [{label, value}] (real occurrence counts,
// not points), `metric` is the Month-wise NR/Utilization table if kept
// checked, `note` is HR's own added text (plain, not HTML).
// Sent from the app's default sender mailbox (GRAPH_SENDER_EMAIL, currently
// samridhi.chugh@koenig-solutions.com), CC'd to HR@koenig-solutions.com and
// the employee's manager (resolved client-side via lib/managerDirectory.js,
// passed through as managerEmail — silently dropped from the CC if
// unresolved, same as sendMail already treats a falsy cc). Sending as
// HR@koenig-solutions.com directly was attempted (lib/graphMailer.js's
// `from` override supports it) but Graph 404s on that address —
// "HR@koenig-solutions.com" doesn't resolve as a mail-enabled object via
// /users at all (confirmed independent of sendMail), so it's likely a
// distribution list/M365 Group rather than a shared mailbox, or the address
// on file is wrong. Revisit once that's sorted — swap back to
// `from: 'HR@koenig-solutions.com'` and drop the cc. Saving also flips
// employees.status to match (PA Issued / PIP Issued), same status field the
// Dept/Overview screens already key off (see close/route.js), and posts to
// RMS via postPaPipToRms above (currently a no-op stub — see its comment).
export async function POST(request, { params }) {
  const { id } = params;
  const body = await request.json().catch(() => null);
  const { name, email, managerEmail, signals, metric, pipType, deadline, note } = body || {};
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
      cc: [HR_CC, managerEmail].filter(Boolean),
      subject: PIP_SUBJECT[pipType],
      html: alertEmailHtml({ name, signals, metric, deadline, note }),
    });
    const db = getDb();
    const res = await db.execute({ sql: 'UPDATE employees SET status = ? WHERE id = ?', args: [PIP_STATUS[pipType], id] });
    if (res.rowsAffected === 0) {
      return NextResponse.json({ ok: false, error: `Email sent, but no employee found with id ${id} to update status.` }, { status: 404 });
    }
    // Best-effort — see postPaPipToRms's own comment. Never let this fail
    // the request; the email's already sent and status already updated.
    try {
      await postPaPipToRms({ employeeId: id, name, pipType, deadline, signals, metric, note });
    } catch (err) {
      console.error(`postPaPipToRms(${id}) failed:`, err.message);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
