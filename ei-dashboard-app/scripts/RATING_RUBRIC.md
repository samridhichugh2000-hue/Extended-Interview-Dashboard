Rating rubric for weekly_responses.ai_rating / ai_rating_reason, 1-5 scale.

Used by: `node scripts/list-unrated-responses.mjs` (produces the input) →
Claude reads each response and rates it against this rubric → results go to
a JSON file → `node scripts/save-ratings.mjs <file>` (persists them).

This is the same rubric applied to the original one-off review
(`Sample Weekly_Response_Review_Rated_Claude.xlsx`), kept here so every
later rating pass — manual or scheduled — stays consistent with it.

Score is about genuine, verifiable progress signal, not effort or tone.

- **5** — Both answers are detailed and name specific, verifiable things
  (numbers, client/course names, deliverables), and are distinct from each
  other (what was done vs. what's planned are not the same thing restated).
- **3-4** — One side is concrete and verifiable, the other is thinner or
  more generic; or both are reasonably substantive but not fully specific.
- **2** — Answers are present but generic — no names, numbers, or
  deliverables to verify progress against. Also use this when the "what I
  did" and "what I'll do" answers are near-duplicates of each other (no
  forward movement visible), or when an answer largely repeats what this
  same person reported the prior week (check `priorA1`/`priorA2`) rather
  than showing new progress.
- **1** — An answer is only a handful of words with no real content (e.g.
  "Good" / "yes") — effectively a non-answer; can't tell what happened or
  is planned.

`reason` should be one terse, analytical sentence — state the concrete
observation that drove the score (what's missing, what repeats, what's
verifiable), not a restatement of the score itself.
