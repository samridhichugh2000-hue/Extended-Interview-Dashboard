// Rates one weekly check-in response against scripts/RATING_RUBRIC.md,
// synchronously, right when the NJ submits — see app/api/weekly-response/
// [token]/route.js. Keep this in sync with the rubric; scripts/list-unrated-
// responses.mjs + scripts/save-ratings.mjs remain as a manual backfill path
// for anything this call fails on (rate limit, timeout, malformed reply).
const PROMPT = ({ q1, a1, q2, a2, priorA1, priorA2 }) => `You are rating one weekly check-in response from a new joiner (NJ), on a 1-5 scale, against this rubric:

- 5: Both answers are detailed and name specific, verifiable things (numbers, client/course names, deliverables), and are distinct from each other (what was done vs. what's planned are not the same thing restated).
- 3-4: One side is concrete and verifiable, the other is thinner or more generic; or both are reasonably substantive but not fully specific.
- 2: Answers are present but generic — no names, numbers, or deliverables to verify progress against. Also use this when the "what I did" and "what I'll do" answers are near-duplicates of each other (no forward movement visible), or when an answer largely repeats what this same person reported the prior week rather than showing new progress.
- 1: An answer is only a handful of words with no real content (e.g. "Good" / "yes") — effectively a non-answer; can't tell what happened or is planned.

Score is about genuine, verifiable progress signal, not effort or tone.

${q1}
A: ${a1}

${q2}
A: ${a2}
${priorA1 || priorA2 ? `\nPrior week's answers, for repetition check:\nA: ${priorA1 || '(none)'}\nA: ${priorA2 || '(none)'}` : ''}

Respond with ONLY a JSON object, no other text: {"rating": 1|2|3|4|5, "reason": "<one terse, analytical sentence — the concrete observation that drove the score, not a restatement of the score>"}`;

export async function rateWeeklyResponse({ q1, a1, q2, a2, priorA1, priorA2 }) {
  // Same hung-request risk as classifyFeedback.js — explicit timeout since
  // fetch has none by default, and this call sits in the NJ's submit path.
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: PROMPT({ q1, a1, q2, a2, priorA1, priorA2 }) }],
      max_tokens: 100,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`OpenAI rate request failed: ${res.status} ${await res.text().catch(() => '')}`);
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || '';
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Could not parse rating response: ${content}`);
  const parsed = JSON.parse(match[0]);
  const rating = Number(parsed.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error(`Invalid rating: ${parsed.rating}`);
  }
  return { rating, reason: String(parsed.reason || '').trim() };
}
