// Which Teams meetings count towards "% of meetings with video on".
// Every team, Sales and Assistant Technical Managers included: all Teams group
// meetings (call record type groupCall). External (client) meetings are tracked
// separately on Graph API Calls and do not narrow this percentage.
// A meeting only counts if the person attended at least this long, so a
// few-second drop-in does not skew the percentage.
export const VIDEO_MIN_ATTEND_SECONDS = 120;
// Same period as the other sections' month columns: the trailing 6 calendar
// months. Microsoft only keeps ~30 days of call records, so what is stored
// builds up daily from when tracking began rather than being backfillable.
export const videoWindowStart = (now = new Date()) => new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();
export const VIDEO_MIN_MEETINGS_TO_SHOW = 3;
export const videoMeetingQualifies = () => true; // kept as a function so callers need no change if a rule is ever added back
