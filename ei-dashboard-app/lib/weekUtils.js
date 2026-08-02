// ISO 8601 week helpers, evaluated in IST (the business's operating
// timezone) rather than server locale — Vercel runs UTC, so "today" or
// "this week is over" must be computed against IST wall-clock time
// explicitly, not whatever timezone the process happens to be in.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istCalendarMidnightUtc(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
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
