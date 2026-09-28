import { NextResponse } from 'next/server';
import { sendMail } from '../../../../../lib/graphMailer';
import { getDb } from '../../../../../lib/db';

export const dynamic = 'force-dynamic';

const HR_CC = 'HR@koenig-solutions.com';
const PIP_STATUS = { PA: 'PA Issued', PIP: 'PIP Issued' };
const PIP_SUBJECT = { PA: 'Performance Alert – Extended Interview', PIP: 'Performance Improvement Plan – Extended Interview' };
// Must match TEST_RECIPIENT in app/DashboardClient.js.
const TEST_RECIPIENT = 'samridhi.chugh@koenig-solutions.com';

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDeadline(deadline) {
  if (!deadline) return '[Deadline Date]';
  const d = new Date(`${deadline}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// `draft` is the body HR edited directly in AlertPreviewModal's textarea —
// plain text (auto-generated from the checked parameters, then freely
// editable), not HTML, so it's escaped and newlines converted to <br/>
// rather than trusted as markup. The deadline/review-period closing lines
// stay fixed here (not part of the editable draft) so they always match
// the deadline picker exactly, regardless of how much HR has edited above.
function alertEmailHtml({ name, draft, deadline }) {
  const body = esc(draft || '').replace(/\n/g, '<br/>');
  return `
    <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">
      <p>Hi ${esc(name)},</p>
      <p>${body}</p>
      <p>The required improvement is expected to be demonstrated by <b>${esc(fmtDeadline(deadline))}</b>.</p>
      <p>Your performance will be reviewed during this period, and further action may be taken based on the outcome of the review.</p>
      <p>Regards,<br/>Team HR</p>
    </div>`;
}

// Posts an issued PA/PIP to RMS (Koenig's own system of record) — the API
// endpoint for this hasn't been provided yet. No-op stub until then; once
// it exists, replace the body with the real call using this exact payload
// (employee id/name, pipType, deadline, the parameters HR chose to cite,
// and the final edited draft) — everything RMS would need is already
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
// parameters/month-wise metric to cite, and edits the resulting draft
// directly before saving — `signals`/`metric` are the checked parameters
// (kept for the RMS payload below; no longer used to render the email
// itself), `draft` is the actual body text HR ends up with.
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
//
// testMode (AlertPreviewModal's "Test mode" checkbox) lets HR verify the
// actual send — real subject/body, real Graph delivery — before ever
// issuing for real: redirects to/cc entirely to TEST_RECIPIENT (no
// employee, no HR, no manager touched) and skips both the employees.status
// update and the RMS post, so nothing about the target employee's real
// record changes.
export async function POST(request, { params }) {
  const { id } = params;
  const body = await request.json().catch(() => null);
  const { name, email, managerEmail, signals, metric, pipType, deadline, draft, testMode } = body || {};
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
      to: testMode ? TEST_RECIPIENT : email,
      cc: testMode ? [] : [HR_CC, managerEmail].filter(Boolean),
      subject: (testMode ? '[TEST] ' : '') + PIP_SUBJECT[pipType],
      html: alertEmailHtml({ name, draft, deadline }),
    });

    if (testMode) {
      return NextResponse.json({ ok: true, test: true });
    }

    const db = getDb();
    const res = await db.execute({ sql: 'UPDATE employees SET status = ? WHERE id = ?', args: [PIP_STATUS[pipType], id] });
    if (res.rowsAffected === 0) {
      return NextResponse.json({ ok: false, error: `Email sent, but no employee found with id ${id} to update status.` }, { status: 404 });
    }
    // Best-effort — see postPaPipToRms's own comment. Never let this fail
    // the request; the email's already sent and status already updated.
    try {
      await postPaPipToRms({ employeeId: id, name, pipType, deadline, signals, metric, draft });
    } catch (err) {
      console.error(`postPaPipToRms(${id}) failed:`, err.message);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
