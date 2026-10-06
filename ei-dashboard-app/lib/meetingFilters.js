// Meetings that aren't part of rep/ATM meeting tracking: ILO sessions, tech
// calls and Course Advice calls (the latter two are already captured by the
// Koenig tech-call API; the Course Advice subject carries the TechcallId).
// Matched on whole words so e.g. "pilot" or "Technical call" don't trip it.
// Also used on email subjects (lib/graphUnreplied.js), so keep this list to
// things that are never worth tracking in either place.
const EXCLUDED_SUBJECT_RE = /\bILO\b|tech[\s-]*call|course\s*advi[cs]e/i;

export function isExcludedMeeting(subject) {
  return EXCLUDED_SUBJECT_RE.test(subject || '');
}

// Calendar entries for a cancelled meeting ("Canceled: …") — nobody can
// attend these, so they are dropped for every team.
const CANCELLED_RE = /^\s*(canceled|cancelled)\s*:/i;

// Sales reps' calendars also carry classroom/training/webinar traffic that is
// not their own selling work. Subjects that are unmistakably that:
//   "Classroom:205099 for Course: …"        classroom batch notice
//   "MS-500.S1 Day 3 - 5", "AI-102 Day 1 - 4"  course-day sessions
//   "ENWLSI,05-October-2026,10061057"       batch code, date, id
//   "264571:CompTIA Cloud+"                 course id prefix
//   webinar / YouTube live / live stream
const SALES_TRAINING_HARD_RE = /^\s*classroom\s*:|\bday\s*\d+\s*-\s*\d+\b|^[A-Z0-9]{3,12}\s*,\s*\d{1,2}-[A-Za-z]+-\d{4}\s*,\s*\d+|^\d{4,}\s*:\s*\S|webinar|you\s*tube|live\s*stream|\bbatch\s*#?\d+/i;
// Generic training words. Real client conversations also use them ("training
// requirement call with Acme"), so these only count when no external
// participant is on the invite — internal sessions, expos, POSH, refreshers.
const SALES_TRAINING_SOFT_RE = /\btrainings?\b|\bsessions?\b|\bworkshops?\b|\bexpo\b|\brefresher\b|\bbootcamp\b|\bseminar\b|\binduction\b|\borientation\b|learn,\s*share|\bcertified\b|\bcertification\b/i;

// Full rule for the Graph meetings views, sync and counts. `clientEmails` is
// the array stored on graph_meetings (empty = internal-only invite).
export function isExcludedGraphMeeting(subject, team, clientEmails) {
  if (isExcludedMeeting(subject)) return true;
  const s = subject || '';
  if (CANCELLED_RE.test(s)) return true;
  if (team === 'Sales') {
    if (SALES_TRAINING_HARD_RE.test(s)) return true;
    if (!(clientEmails && clientEmails.length) && SALES_TRAINING_SOFT_RE.test(s)) return true;
  }
  return false;
}
