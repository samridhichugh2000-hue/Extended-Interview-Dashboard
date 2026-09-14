import { NextResponse } from 'next/server';
import { sendMail } from '../../../../../lib/graphMailer';

export const dynamic = 'force-dynamic';

const HR_CC = 'HR@koenig-solutions.com';

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function alertEmailHtml({ name, score, bandLabel, signals }) {
  const list = (signals || [])
    .map((s) => `<li>${esc(s.label)} (${esc(s.ptsStr)})</li>`)
    .join('');
  return `
    <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">
      <p>Hi ${esc(name)},</p>
      <p>Your current Worry Index stands at <b>${esc(score)}</b> (${esc(bandLabel)}). This has been flagged for HR review.</p>
      ${list ? `<p style="margin-bottom:4px;">The following was noted:</p><ul>${list}</ul>` : ''}
      <p>Someone from HR will be reaching out shortly to discuss your progress and any support you may need.</p>
      <p>Best regards,<br/>EI Dashboard</p>
    </div>`;
}

// Fired from the "Alert" action on the Dept table row and the EmployeeModal's
// "Send feedback alert" chip, shown once an NJ's Worry Index hits the
// Critical band (score <= -4, see lib/data.js band()). Opens a preview
// (AlertPreviewModal in DashboardClient.js) where HR picks which fired
// signals to mention before sending — `signals` here is that selection,
// [{label, ptsStr}], not the full signal report. Score/band/name are already
// computed client-side (decorate() runs there) so this route just sends the
// notification rather than re-deriving the whole scoring pipeline
// server-side. Same-origin only, no secret gate — matches every other
// UI-facing route in this app.
export async function POST(request) {
  const body = await request.json().catch(() => null);
  const { name, email, score, bandLabel, signals } = body || {};
  if (!email) {
    return NextResponse.json({ ok: false, error: 'No email on file for this employee.' }, { status: 400 });
  }
  try {
    await sendMail({
      to: email,
      cc: HR_CC,
      subject: `Worry Index Alert — ${name}`,
      html: alertEmailHtml({ name, score, bandLabel, signals }),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
