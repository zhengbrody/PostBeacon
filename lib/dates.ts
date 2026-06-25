/** Format the real calendar date for a launch-sequence day, given a launch date. */
export function scheduleDate(launchDate: string, day: number): string {
  if (!launchDate) return "";
  const base = new Date(launchDate + "T00:00:00");
  if (isNaN(base.getTime())) return "";
  base.setDate(base.getDate() + (day - 1)); // day 1 = launch day
  return base.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
