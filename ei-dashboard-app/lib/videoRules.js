// Which Teams meetings count towards "% of meetings with video on".
// - Sales: only meetings with an external participant (clients).
// - Every other team: all Teams meetings (call record type groupCall).
// A meeting only counts if the person attended at least this long, so a
// few-second drop-in does not skew the percentage.
export const VIDEO_MIN_ATTEND_SECONDS = 120;
export const VIDEO_WINDOW_DAYS = 30;
export const VIDEO_MIN_MEETINGS_TO_SHOW = 3;
export const videoMeetingQualifies = (team, isExternal) => team !== 'Sales' || !!isExternal;
