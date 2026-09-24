// ISO 8601 week helpers, evaluated in IST (the business's operating
// timezone) rather than server locale — Vercel runs UTC, so "today" or
// "this week is over" must be computed against IST wall-clock time
// explicitly, not whatever timezone the process happens to be in.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istCalendarMidnightUtc(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

// 'YYYY-MM-DD' for the IST calendar date the given instant falls on — lets
// callers compare "same IST day" (e.g. an email sent earlier today) without
// each doing their own offset math.
export function istDateKey(date) {
  return istCalendarMidnightUtc(date).toISOString().slice(0, 10);
}

// 'YYYY-Www' for the IST calendar date the given instant falls on.
export function getIsoWeek(date) {
  const d = istCalendarMidnightUtc(date);
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday, per ISO week definition

  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);

  const weekNum = 1 + Math.round((d - firstThursday) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// { start, end } as real Date instants — Monday 00:00:00 IST through Sunday
// 23:59:59.999 IST of that ISO week.
export function weekDateRange(weekStr) {
  const [yearStr, wStr] = weekStr.split('-W');
  const year = parseInt(yearStr, 10);
  const week = parseInt(wStr, 10);

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day);

  const targetMondayCalendar = new Date(week1Monday);
  targetMondayCalendar.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);

  // targetMondayCalendar is midnight UTC on the right calendar date — shift
  // back by the IST offset to get the instant that's actually midnight IST.
  const start = new Date(targetMondayCalendar.getTime() - IST_OFFSET_MS);
  const end = new Date(start.getTime() + 7 * 86400000 - 1);
  return { start, end };
}

export function isWeekOver(weekStr) {
  return Date.now() > weekDateRange(weekStr).end.getTime();
}

// Wednesday 18:00 IST of the given ISO week — the same instant the weekly
// response digest report / shoddy auto-marking (/api/sync/weeklyresponsereport)
// fires, giving NJs the full 48-hour grace period from Monday morning's
// check-in email before non-response counts against them. Used to decide
// when "hasn't responded yet" starts counting against the Worry Index,
// rather than waiting for the full week (isWeekOver) to close out.
export function isPastWednesdayCheckIn(weekStr) {
  const { start } = weekDateRange(weekStr); // Monday 00:00 IST
  const wednesdaySixPm = start.getTime() + 66 * 60 * 60 * 1000; // + 66h = Wednesday 18:00 IST
  return Date.now() >= wednesdaySixPm;
}

// True only on Monday, IST. The weekly check-in emails (NJ and PA/PIP) are
// meant to go out once, on Monday, full stop — no catch-up send later in the
// week for people newly added/flagged after Monday's run. sendWeeklyReports
// and sendPaPipWeeklyCheckIns both gate on this before doing anything, even
// though the underlying cron still fires daily (see vercel.json) — it's just
// a no-op every day that isn't Monday.
export function isMondayIst(date = new Date()) {
  return istCalendarMidnightUtc(date).getUTCDay() === 1;
}
