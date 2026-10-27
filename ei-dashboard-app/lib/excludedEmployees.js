// Employees that must never appear on the dashboard even though Koenig lists
// them under a tracked department (it only tags some blue-collar staff as
// "Blue Collared"). syncKoenig skips these ids, so deleting one from Turso
// sticks instead of being re-added by the next new-joiner sync.
export const EXCLUDED_EMP_IDS = new Set([
  'EMP4921', // Karan Kumar — Office Boy, blue-collar (removed 2026-10-27)
]);
