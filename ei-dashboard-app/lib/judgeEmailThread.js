// Decides, for one email thread sitting in an employee's mailbox, whether the
// employee was clearly expected to respond/act and has not. Replaces the old
// last-message-only classifier (classifyEmail.js) with a judgement over the
// WHOLE available conversation — received mail plus the employee's own sent
// items — following the "email not replied for more than 7 days" rules:
// accuracy over volume, and anything that cannot be confirmed is "needs_review",
// never "unanswered".
//
// The thread text is sent to OpenAI for this one decision and is NOT stored —
// only the verdict and a short reason are kept (email_thread_verdicts, keyed by
// employee + conversation + the thread's latest message id, so an unchanged
// thread is judged once).
import { getDb } from './db.js';

export const THREAD_VERDICTS = {
  unanswered: 'Unanswered',
  answered: 'Answered / resolved',
  not_actionable: 'No action needed',
  needs_review: 'Needs review',
};

// Running totals for this process, so a sync can report what the run cost.
export const judgeUsage = { calls: 0, promptTokens: 0, completionTokens: 0 };

const MODEL = process.env.OPENAI_EMAIL_MODEL || 'gpt-6-luna';

const PROMPT = ({ employeeName, employeeEmail, requestFrom, sharedSender, thread, otherSent }) => `You are checking one email conversation for an HR dashboard. Employee under review: ${employeeName} <${employeeEmail}>.

The conversation below is in chronological order. "RECEIVED" = a message the employee received. "SENT BY EMPLOYEE" = a message the employee sent (replies, forwards, follow-ups) from their Sent Items. The earliest message the employee has not yet answered is marked [REQUEST CLOCK STARTS HERE] — it came from ${requestFrom}${sharedSender ? ' (a group / shared mailbox address, not a named person)' : ''}.

Decide ONE verdict about whether ${employeeName} still owes a response:

- "unanswered": the employee was CLEARLY expected to respond or act (confirm/acknowledge, approve, clarify, share information/report/document, give an update or feedback, complete or follow up on a task, or any other request addressed to them), AND no meaningful response from the employee appears anywhere in the conversation, AND the request is still relevant (not cancelled, withdrawn or resolved).
- "answered": the employee already gave a meaningful response — a confirmation, acknowledgement, clarification, a progress update, or a reply/forward that handles the request — even if the conversation continued afterwards; OR the request was cancelled, withdrawn, resolved or overtaken by later messages. A reminder or follow-up from the sender does NOT mean the employee failed to respond.
- "not_actionable": the mail needs no response from this employee — information/awareness only, announcement or general notification, newsletter/promotional/marketing, automated mail needing no action, the employee is only copied for information, a report or "please find attached" with no ask, a plain thank-you/ok that closes the loop, or a hunt-group / shared-mailbox mail where no individual has been assigned the action (it is only actionable if it is forwarded to the employee or the employee is specifically given responsibility).
- "needs_review": you cannot confirm who is responsible (e.g. several people addressed and it is unclear it is the employee's task, or a group mailbox with an unclear assignment), or you cannot tell from the conversation whether the employee already responded or the request is still live. Use this instead of guessing.

Rules: judge the content and context, not keywords. Never assume an email is unanswered without checking the whole conversation. Do not count a reminder as a new request. When the evidence is incomplete, choose "needs_review", not "unanswered". A real, direct, still-open request that the employee never answered is "unanswered".
- "Responding" means replying or acting by email. A system notification or calendar-style reminder (e.g. "your interview starts in 15 minutes", "meeting reminder", booking/portal notices, assignment notices) is "not_actionable", even if it tells the employee to attend or do something elsewhere.
- Unsolicited first-contact mail from an external party — cold outreach, a vendor or agency pitch, a job-seeker or candidate writing on spec, a resume sent unprompted — where the employee has no earlier message in the conversation and nobody at the company assigned it to them, is "needs_review" (their responsibility is not confirmed), not "unanswered". It is "unanswered" only when the conversation shows an existing process the employee owns (for example the company already wrote to that person, scheduled something with them, or an internal colleague asked the employee to handle it).
- A confirmation or receipt for the employee's OWN earlier submission ("your response has been recorded", "we have received your request", "thank you for your feedback") is "not_actionable".
- Some requests are answered somewhere other than email: a poll / survey / feedback / "click this link" mail, an approval or claim in a portal or HRMS (leave, TA bill), a lead or task to work in a CRM or RMS, an interview or mock-session invite. Not having emailed back proves nothing about these, so the response history cannot be confirmed: choose "needs_review" — unless the sender explicitly asks for an email reply and none exists, in which case it is "unanswered".
- "unanswered" needs an explicit, or clearly implied, ask directed at the employee in the request message itself. Do not invent obligations that are not in the text — for example that the employee must acknowledge receipt of documents nobody asked them to acknowledge. A message that only delivers material, says thanks or shares news is "not_actionable".
- The list "OTHER MAIL SENT TO THE SAME PERSON" shows mail the employee sent that person after the request, outside this conversation. If a subject plainly relates to the request, treat it as a response ("answered"). If it is unclear whether it relates and the request is otherwise unanswered, choose "needs_review".

OTHER MAIL SENT TO THE SAME PERSON (after the request, different conversation):
${otherSent || '(none)'}

CONVERSATION:
${thread}

Respond with ONLY a JSON object, no other text: {"verdict": "unanswered"|"answered"|"not_actionable"|"needs_review", "reason": "<what is asked / why, under 20 words>"}`;

let ensured = false;
async function ensureTable(db) {
  if (ensured) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS email_thread_verdicts (
    employee_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    last_message_id TEXT NOT NULL,
    verdict TEXT NOT NULL,
    reason TEXT,
    judged_at TEXT NOT NULL,
    PRIMARY KEY (employee_id, conversation_id)
  )`);
  ensured = true;
}

async function callOpenAi(args) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: PROMPT(args) }],
        max_completion_tokens: 2000, // reasoning tokens count against this
        reasoning_effort: process.env.OPENAI_EMAIL_REASONING || 'low',
      }),
      signal: AbortSignal.timeout(90000),
    });
    if ([429, 500, 502, 503].includes(res.status) && attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 2000));
      continue;
    }
    if (!res.ok) throw new Error(`OpenAI thread judge failed: ${res.status}`);
    const json = await res.json();
    judgeUsage.calls++;
    judgeUsage.promptTokens += json.usage?.prompt_tokens || 0;
    judgeUsage.completionTokens += json.usage?.completion_tokens || 0;
    const content = json.choices?.[0]?.message?.content || '';
    const match = content.match(/\{[\s\S]*\}/);
    let parsed = null;
    try { parsed = match ? JSON.parse(match[0]) : null; } catch { parsed = null; }
    // A cut-off or malformed answer is retried once or twice before giving up.
    if (!parsed || !THREAD_VERDICTS[parsed.verdict]) {
      if (attempt < 3) continue;
      throw new Error(parsed ? `Invalid thread verdict: ${parsed.verdict}` : 'Could not parse thread verdict');
    }
    return { verdict: parsed.verdict, reason: String(parsed.reason || '').trim() };
  }
}

// Previously judged, unchanged threads for this employee ->
// Map(conversationId -> { lastMessageId, verdict, reason }).
export async function getCachedVerdicts(employeeId) {
  const db = getDb();
  await ensureTable(db);
  const res = await db.execute({ sql: 'SELECT conversation_id, last_message_id, verdict, reason FROM email_thread_verdicts WHERE employee_id = ?', args: [employeeId] });
  return new Map(res.rows.map((r) => [r.conversation_id, { lastMessageId: r.last_message_id, verdict: r.verdict, reason: r.reason }]));
}

// Judge one thread and remember the verdict. Fails SAFE: if the judge cannot be
// reached or read, the thread becomes "needs_review" (never counted as
// unanswered) and is not cached, so the next run retries it.
export async function judgeEmailThread({ employee, conversationId, lastMessageId, requestFrom, sharedSender, thread, otherSent }) {
  try {
    const v = await callOpenAi({ employeeName: employee.name, employeeEmail: employee.email, requestFrom, sharedSender, thread, otherSent });
    const db = getDb();
    await ensureTable(db);
    await db.execute({
      sql: `INSERT INTO email_thread_verdicts (employee_id, conversation_id, last_message_id, verdict, reason, judged_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(employee_id, conversation_id) DO UPDATE SET last_message_id = excluded.last_message_id, verdict = excluded.verdict, reason = excluded.reason, judged_at = excluded.judged_at`,
      args: [employee.id, conversationId, lastMessageId, v.verdict, v.reason, new Date().toISOString()],
    });
    return v;
  } catch (err) {
    console.error('judgeEmailThread failed:', err.message);
    return { verdict: 'needs_review', reason: 'Could not be read automatically — check manually', failed: true };
  }
}
