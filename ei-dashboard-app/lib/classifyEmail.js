// Reads the LAST message of an unreplied thread and decides whether it
// actually needs the employee's response. Used by lib/graphUnreplied.js so the
// "unreplied" count only holds mail someone is genuinely waiting on, not
// reports, "ok"/"thanks" acknowledgements or FYI notes.
//
// The email text is sent to OpenAI for this one decision and is NOT stored —
// only the label and a short reason are kept (email_classifications, keyed by
// message id, so a message is classified once).
import { getDb } from './db.js';

export const EMAIL_LABELS = {
  needs_response: 'Needs response',
  acknowledgement: 'Acknowledgement',
  report_fyi: 'Report / FYI',
  information: 'Information only',
};

const PROMPT = ({ subject, from, text }) => `You are triaging one email that sits unanswered in an employee's inbox. It is the LAST message of its thread. Decide whether the employee actually has to respond to it.

Choose exactly one label:
- "needs_response": the sender asks a question, requests an action, approval, input, confirmation, a document or a meeting/time, or the thread is clearly waiting on the employee to reply.
- "acknowledgement": a short ok / thanks / noted / received / got it / sure / will do / confirmed message written BY the sender that closes the loop and expects nothing back. A mail that ASKS the employee to acknowledge, confirm receipt, sign or reply is "needs_response", not an acknowledgement.
- "report_fyi": a report, MIS, dashboard, statement, summary, newsletter-style update or "for your information / please find attached" mail that is shared to be read, with no ask.
- "information": a plain informational message (announcement, status update, notice, heads-up) with no question or request directed at the employee.

When the mail contains a real question or a request addressed to the employee, choose "needs_response" even if it is polite or short. When unsure between needs_response and the others, choose needs_response.

Subject: ${subject}
From: ${from}
Email text (may be truncated):
"""
${text}
"""

Respond with ONLY a JSON object, no other text: {"label": "needs_response"|"acknowledgement"|"report_fyi"|"information", "reason": "<under 12 words>"}`;

let ensured = false;
async function ensureTable(db) {
  if (ensured) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS email_classifications (
    message_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    reason TEXT,
    classified_at TEXT NOT NULL
  )`);
  ensured = true;
}

async function callOpenAi(args) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: PROMPT(args) }],
      max_completion_tokens: 400, // reasoning tokens count against this, so leave headroom
      reasoning_effort: 'minimal',
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`OpenAI email classify failed: ${res.status}`);
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || '';
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse email classification');
  const parsed = JSON.parse(match[0]);
  if (!EMAIL_LABELS[parsed.label]) throw new Error(`Invalid email label: ${parsed.label}`);
  return { label: parsed.label, reason: String(parsed.reason || '').trim() };
}

// Cached verdicts for these message ids -> Map(id -> {label, reason}).
export async function getCachedClassifications(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const db = getDb();
  await ensureTable(db);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const res = await db.execute({
      sql: `SELECT message_id, label, reason FROM email_classifications WHERE message_id IN (${chunk.map(() => '?').join(',')})`,
      args: chunk,
    });
    for (const r of res.rows) out.set(r.message_id, { label: r.label, reason: r.reason });
  }
  return out;
}

// Classify one message (text already fetched) and remember the verdict. Fails
// open: if OpenAI is unreachable the mail stays 'needs_response' (so a real
// ask is never hidden) and the verdict is not cached, so it is retried later.
export async function classifyEmail({ id, subject, from, text }) {
  try {
    const verdict = await callOpenAi({ subject: subject || '(no subject)', from: from || 'unknown', text: (text || '').slice(0, 1500) });
    const db = getDb();
    await ensureTable(db);
    await db.execute({
      sql: `INSERT INTO email_classifications (message_id, label, reason, classified_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(message_id) DO UPDATE SET label = excluded.label, reason = excluded.reason, classified_at = excluded.classified_at`,
      args: [id, verdict.label, verdict.reason, new Date().toISOString()],
    });
    return verdict;
  } catch (err) {
    console.error('classifyEmail failed:', err.message);
    return { label: 'needs_response', reason: 'Could not be read — counted to be safe', unclassified: true };
  }
}
