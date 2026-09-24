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
      <p style="color:#B91C1C;font-weight:600;">Please note: non-response to this email will lead to a Shoddy by HR.</p>
      <p>Thank you for your time and participation.</p>
      <p>Best regards,<br/>EI Dashboard</p>
      <p><a href="${link}" style="display:inline-block;background:#6366F1;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Submit your answers</a></p>
      <p style="color:#666;font-size:12.5px;">If the button doesn't work, use this link: ${link}</p>
    </div>`;
}

// Same shape as initialEmailHtml, reworded so it never implies the recipient
// is a new joiner (this goes to PA/PIP employees who are past the 6-month NJ
// check-in window — see sendPaPipWeeklyCheckIns below) — no "initial months
// with the organization" line, otherwise identical structure/tone.
export function paPipEmailHtml({ name, q1, q2, link }) {
  return `
    <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">
      <p>Hi ${name},</p>
      <p>As part of our regular Check-In, we would like to understand your progress and focus areas for the week.</p>
      <p>Please take a minute to respond to the following two questions. Please click the button below to submit your responses:</p>
      <ol style="padding-left:18px;">
        <li style="margin-bottom:8px;">${q1}</li>
        <li style="margin-bottom:8px;">${q2}</li>
      </ol>
      <p>Your responses will help HR track your progress, understand your current priorities, and identify any support you may need going forward.</p>
      <p style="color:#B91C1C;font-weight:600;">Please note: non-response to this email will lead to a Shoddy by HR.</p>
      <p>Thank you for your time and participation.</p>
      <p>Best regards,<br/>EI Dashboard</p>
      <p><a href="${link}" style="display:inline-block;background:#6366F1;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Submit your answers</a></p>
      <p style="color:#666;font-size:12.5px;">If the button doesn't work, use this link: ${link}</p>
    </div>`;
}

// Shared by sendWeeklyReports and sendPaPipWeeklyCheckIns — both insert one
// weekly_responses row per eligible employee (skipping anyone already sent
// this ISO week) and fire the initial check-in email off the same token/link
// scheme; they differ only in which employees qualify and the email's
// subject/copy.
async function sendCheckIns({ db, week, employees, questionsByTeam, baseUrl, subjectFor, htmlFor, getManagerEmail, sendMail }) {
  const already = await db.execute({ sql: 'SELECT employee_id FROM weekly_responses WHERE week = ?', args: [week] });
  const alreadySent = new Set(already.rows.map((r) => r.employee_id));

  let sent = 0;
  let skippedSent = 0;
  let skippedNoEmail = 0;
  let skippedNoQuestions = 0;
  for (const emp of employees) {
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
      cc: getManagerEmail(emp.manager),
      subject: subjectFor(emp),
      html: htmlFor({ name: emp.name, q1: q.q1, q2: q.q2, link }),
    });
    sent++;
  }

  return { sent, total: employees.length, skippedSent, skippedNoEmail, skippedNoQuestions };
}

// Batch send — per-employee questions come from NJ_QUESTIONS in lib/data.js
// (a plain constants module, no 'use client', safe to import server-side —
// same as lib/queries.js already does for computeSignalReport etc).
export async function sendWeeklyReports() {
  const { getIsoWeek, isMondayIst } = await import('./weekUtils.js');
  if (!isMondayIst()) {
    return { message: 'Skipped — weekly NJ check-in only sends on Monday (IST), not today.' };
  }

  const db = getDb();
  const { NJ_QUESTIONS } = await import('./data.js');
  const { sendMail } = await import('./graphMailer.js');
  const { getManagerEmail } = await import('./managerDirectory.js');

  const week = getIsoWeek(new Date());
  const questionsByTeam = new Map(NJ_QUESTIONS.map((q) => [q.team, q]));
  const baseUrl = process.env.APP_BASE_URL;

  const employees = await db.execute("SELECT id, name, email, team, manager FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1 AND tenure_days < 182");

  const r = await sendCheckIns({
    db, week, employees: employees.rows, questionsByTeam, baseUrl, getManagerEmail, sendMail,
    subjectFor: (emp) => `Weekly NJ Check-In - ${emp.name}`,
    htmlFor: initialEmailHtml,
  });

  return { message: `Sent ${r.sent} of ${r.total} eligible active NJs for ${week} (${r.skippedSent} already sent, ${r.skippedNoEmail} no email on file${r.skippedNoQuestions ? `, ${r.skippedNoQuestions} no questions for team` : ''}).` };
}

// A PA/PIP case counts as "ongoing" only if today falls inside its own
// issued_on..review_by window — Koenig's is_active flag alone isn't enough
// to go by, since Koenig doesn't auto-close a case just because its review
// date passed (a case sits "active" indefinitely until someone formally
// closes it there). issued_on/review_by are display strings like "29 Jan
// 2026", which Date() parses fine for this day-level comparison.
function hasOngoingPipWindow(pipRows, wantType, today) {
  return pipRows.some((r) => {
    if (r.type !== wantType) return false;
    const start = r.issued_on && new Date(r.issued_on);
    const end = r.review_by && new Date(r.review_by);
    if (!start || isNaN(start) || !end || isNaN(end)) return false;
    return start <= today && today <= end;
  });
}

// Same weekly cadence and weekly_responses tracking as the NJ check-in, but
// for active PA/PIP employees who've aged out of the 6-month NJ window
// (tenure_days >= 182, the NJ query's cutoff above) — they'd otherwise get
// no structured check-in at all once they stop being a "new joiner". Kept as
// a second population under the same 'weeklyreport' feed/cron rather than a
// standalone sync feed, since Vercel Hobby's 2-native-cron cap is already
// used by weeklyreport + weeklyresponsereport (see vercel.json) and this
// needs to run the same day/cadence anyway.
export async function sendPaPipWeeklyCheckIns() {
  const { getIsoWeek, isMondayIst } = await import('./weekUtils.js');
  if (!isMondayIst()) {
    return { message: 'Skipped — weekly PA/PIP check-in only sends on Monday (IST), not today.' };
  }

  const db = getDb();
  const { NJ_QUESTIONS } = await import('./data.js');
  const { sendMail } = await import('./graphMailer.js');
  const { getManagerEmail } = await import('./managerDirectory.js');

  const week = getIsoWeek(new Date());
  const questionsByTeam = new Map(NJ_QUESTIONS.map((q) => [q.team, q]));
  const baseUrl = process.env.APP_BASE_URL;
  const today = new Date();

  const candidates = await db.execute(
    "SELECT id, name, email, team, manager, status FROM employees WHERE team IN ('Sales', 'Trainer', 'PT Team') AND active = 1 AND tenure_days >= 182 AND status IN ('PA Issued', 'PIP Issued')"
  );

  const ids = candidates.rows.map((e) => e.id);
  const pipStatusRows = ids.length
    ? await db.execute({ sql: `SELECT * FROM pip_status WHERE employee_id IN (${ids.map(() => '?').join(',')})`, args: ids })
    : { rows: [] };
  const pipByEmp = new Map();
  for (const p of pipStatusRows.rows) {
    if (!pipByEmp.has(p.employee_id)) pipByEmp.set(p.employee_id, []);
    pipByEmp.get(p.employee_id).push(p);
  }

  // Only the employees whose current status type actually has an ongoing
  // (not lapsed, not future) window get the check-in — this is what "active
  // PA/PIP" is supposed to mean, not just an unclosed Koenig flag.
  const employees = candidates.rows.filter((e) => {
    const wantType = e.status === 'PIP Issued' ? 'PIP' : 'PA';
    return hasOngoingPipWindow(pipByEmp.get(e.id) || [], wantType, today);
  });
  const skippedLapsed = candidates.rows.length - employees.length;

  const r = await sendCheckIns({
    db, week, employees, questionsByTeam, baseUrl, getManagerEmail, sendMail,
    subjectFor: (emp) => `Weekly Progress Check-In - ${emp.name}`,
    htmlFor: paPipEmailHtml,
  });

  return { message: `Sent ${r.sent} of ${r.total} employees with an ongoing PA/PIP window for ${week} (${r.skippedSent} already sent, ${r.skippedNoEmail} no email on file${r.skippedNoQuestions ? `, ${r.skippedNoQuestions} no questions for team` : ''}, ${skippedLapsed} excluded — PA/PIP flagged active in Koenig but window already lapsed).` };
}
