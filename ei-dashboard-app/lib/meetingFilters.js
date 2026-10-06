// Meetings that aren't part of rep/ATM meeting tracking: ILO sessions, tech
// calls and Course Advice calls (the latter two are already captured by the
// Koenig tech-call API; the Course Advice subject carries the TechcallId).
// Matched on whole words so e.g. "pilot" or "Technical call" don't trip it.
const EXCLUDED_SUBJECT_RE = /\bILO\b|tech[\s-]*call|course\s*advi[cs]e/i;

export function isExcludedMeeting(subject) {
  return EXCLUDED_SUBJECT_RE.test(subject || '');
}
