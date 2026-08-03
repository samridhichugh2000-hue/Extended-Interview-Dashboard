import { randomBytes } from 'crypto';
import { getDb } from './db';

function genToken() {
  return randomBytes(24).toString('base64url');
}

export function initialEmailHtml({ name, q1, q2, link }) {
  return `
    <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">
      <p>Hi ${name},</p>
      <p>As part of our regular Check-In, we would like to understand your progress and focus areas for the week.</p>
      <p>Please take a minute to respond to the following two questions. Please click the button below to submit your responses:</p>
      <ol style="padding-left:18px;">
        <li style="margin-bottom:8px;">${q1}</li>
        <li style="margin-bottom:8px;">${q2}</li>
      </ol>
      <p>Your responses will help HR track your progress, understand your current priorities, and identify any support required during your initial months with the organization.</p>
      <p>Thank you for your time and participation.</p>
      <p>Best regards,<br/>EI Dashboard</p>
      <p><a href="${link}" style="display:inline-block;background:#6366F1;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Submit your answers</a></p>
      <p style="color:#666;font-size:12.5px;">If the button doesn't work, use this link: ${link}</p>
    </div>`;
}

// Batch send — per-employee questions come from NJ_QUESTIONS in lib/data.js
// (a plain constants module, no 'use client', safe to import server-side —
// same as lib/queries.js already does for computeSignalReport etc).
export async function sendWeeklyReports() {
  const db = getDb();
  const { NJ_QUESTIONS } = await import('./data.js');
  const { sendMail } = await import('./graphMailer.js');
  const { getIsoWeek } = await import('./weekUtils.js');

  const week = getIsoWeek(new Date());
  const questionsByTeam = new Map(NJ_QUESTIONS.map((q) => [q.team, q]));
  const baseUrl = process.env.APP_BASE_URL;

  const employees = await db.execute("SELECT id, name, email, team FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1");

  const already = await db.execute({ sql: 'SELECT employee_id FROM weekly_responses WHERE week = ?', args: [week] });
  const alreadySent = new Set(already.rows.map((r) => r.employee_id));

  let sent = 0;
  let skippedSent = 0;
  let skippedNoEmail = 0;
  let skippedNoQuestions = 0;
  for (const emp of employees.rows) {
    if (alreadySent.has(emp.id)) { skippedSent++; continue; }
    if (!emp.email) { skippedNoEmail++; continue; }
    const q = questionsByTeam.get(emp.team);
    if (!q) { skippedNoQuestions++; continue; }

    const token = genToken();
    const link = `${baseUrl}/respond/${token}`;

    await db.execute({
      sql: `INSERT INTO weekly_responses (employee_id, week, sent_at, received_at, state, q1, a1, q2, a2, ai_rating, token)
            VALUES (?, ?, ?, NULL, 'Pending', ?, NULL, ?, NULL, NULL, ?)`,
      args: [emp.id, week, new Date().toISOString(), q.q1, q.q2, token],
    });

    await sendMail({
      to: emp.email,
      subject: `Weekly NJ Check-In - ${emp.name}`,
      html: initialEmailHtml({ name: emp.name, q1: q.q1, q2: q.q2, link }),
    });
    sent++;
  }

  return { message: `Sent ${sent} of ${employees.rows.length} eligible active NJs for ${week} (${skippedSent} already sent, ${skippedNoEmail} no email on file${skippedNoQuestions ? `, ${skippedNoQuestions} no questions for team` : ''}).` };
}
