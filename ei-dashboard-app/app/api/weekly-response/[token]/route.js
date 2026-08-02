import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function confirmationEmailHtml({ name, week, q1, a1, q2, a2 }) {
  return `
    <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">
      <p>Hi ${name},</p>
      <p>Thanks — your check-in for ${week} has been recorded:</p>
      <p><b>${q1}</b><br/>${a1}</p>
      <p><b>${q2}</b><br/>${a2}</p>
    </div>`;
}

export async function POST(request, { params }) {
  const { token } = params;
  const body = await request.json().catch(() => null);
  const a1 = body?.a1?.trim();
  const a2 = body?.a2?.trim();
  if (!a1 || !a2) {
    return NextResponse.json({ ok: false, error: 'Both answers are required.' }, { status: 400 });
  }

  const db = getDb();
  const existing = await db.execute({
    sql: `SELECT wr.*, e.name, e.email FROM weekly_responses wr
          JOIN employees e ON e.id = wr.employee_id
          WHERE wr.token = ?`,
    args: [token],
  });
  const row = existing.rows[0];
  if (!row) {
    return NextResponse.json({ ok: false, error: 'Link not found.' }, { status: 404 });
  }
  if (row.state === 'Received') {
    return NextResponse.json({ ok: false, error: 'This response has already been submitted.' }, { status: 409 });
  }

  await db.execute({
    sql: `UPDATE weekly_responses SET a1 = ?, a2 = ?, received_at = ?, state = 'Received' WHERE token = ?`,
    args: [a1, a2, new Date().toISOString(), token],
  });

  // A Graph hiccup here shouldn't lose an already-recorded answer — log and
  // still report success to the NJ.
  if (row.email) {
    try {
      const { sendMail } = await import('../../../../lib/graphMailer');
      await sendMail({
        to: row.email,
        cc: process.env.GRAPH_SENDER_EMAIL,
        subject: `Your response has been recorded — ${row.week}`,
        html: confirmationEmailHtml({ name: row.name, week: row.week, q1: row.q1, a1, q2: row.q2, a2 }),
      });
    } catch (err) {
      console.error('Weekly response confirmation email failed:', err.message);
    }
  }

  return NextResponse.json({ ok: true });
}
