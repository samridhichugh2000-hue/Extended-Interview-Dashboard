// Koenig's manager-feedback survey is often structured: the manager picks a
// rating per question ("Discipline : Above Average; Suitable for the role
// hired for? : Average; WFH capable - Above Average; Comment : ...") and then
// adds a free-text comment. Those picks ARE the manager's verdict, so they
// decide the rating outright - the comment must never override them (an AI
// read of "Areas of Improvement- Time management" once turned an Above
// Average / Average / Above Average entry into "below satisfactory").
//
// Returns 'below' | 'satisfactory' | 'above', or null when the entry has no
// structured ratings (plain prose - left to the AI classifier).
//   - any "Below Average" pick          -> 'below'
//   - every pick "Above Average"        -> 'above'
//   - otherwise (Average / Above mix)   -> 'satisfactory'
export function structuredFeedbackRating(entry) {
  const text = [entry?.strength, entry?.improvement, entry?.other].filter(Boolean).join(' ');
  if (!text) return null;
  // Only the rating section - the free-text comment after "Comment :" can
  // contain the same words ("above average performance") without being a pick.
  const head = text.split(/comment\s*:/i)[0];
  const picks = [...head.matchAll(/[:\-]\s*(above average|below average|average)\s*(?:;|$)/gi)].map((m) => m[1].toLowerCase());
  if (!picks.length) return null;
  if (picks.includes('below average')) return 'below';
  if (picks.every((p) => p === 'above average')) return 'above';
  return 'satisfactory';
}
