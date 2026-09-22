// Reads a single manager-feedback entry (Koenig's GetIncidentData feed mixes
// two different survey types under the same endpoint: actual performance
// feedback, and an unrelated onboarding-formalities checklist) and decides:
// - genuine performance feedback -> 'below' | 'satisfactory' | 'above'
// - not real performance feedback at all (onboarding checklist etc.) -> 'not-applicable'
// Used by scripts/sync-mgrfeedback.mjs so every entry gets a real read
// instead of the old literal "average"/"satisfactory" keyword match, which
// missed plain-English critical feedback that never uses those exact words.
const PROMPT = (text) => `You are classifying one manager-feedback entry for an employee performance tracking system.

First decide: is this genuine qualitative feedback about the employee's work performance (discipline, delivery quality, meeting prep, exam/assessment results, punctuality, attitude, etc.)? If it's actually an unrelated onboarding-formalities checklist (e.g. "Did the candidate complete joining documents on time?", follow-ups/reminders about paperwork) or otherwise not performance feedback, classify it "not-applicable".

If it IS genuine performance feedback, classify it:
- "below": corrective/critical — flags a gap, asks for improvement, describes a problem, no real positive framing
- "satisfactory": solid/acceptable — meets expectations, or a genuine mix of good and needs-improvement with no serious concern
- "above": clearly exceeds expectations — strongly positive, no notable concerns

Entry text:
"""
${text}
"""

Respond with ONLY a JSON object, no other text: {"rating": "below"|"satisfactory"|"above"|"not-applicable", "reason": "<under 12 words>"}`;

export async function classifyFeedback({ strength, improvement, other }) {
  const text = [strength, improvement, other].filter(Boolean).join(' ').trim();
  if (!text) return { rating: 'not-applicable', reason: 'blank entry' };

  // A hung request here (seen in practice: one call never resolved and
  // never rejected, stalling the whole sync for hours with zero progress)
  // needs an explicit timeout, since fetch has none by default.
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: PROMPT(text) }],
      max_tokens: 80,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`OpenAI classify request failed: ${res.status} ${await res.text().catch(() => '')}`);
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || '';
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Could not parse classify response: ${content}`);
  const parsed = JSON.parse(match[0]);
  if (!['below', 'satisfactory', 'above', 'not-applicable'].includes(parsed.rating)) {
    throw new Error(`Invalid rating: ${parsed.rating}`);
  }
  return { rating: parsed.rating, reason: String(parsed.reason || '').trim() };
}
