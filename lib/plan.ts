import type { PlatformDef } from "./platforms";
import type { PlatformRecommendation, ScheduleItem } from "./types";

/**
 * Shared plan-shaping helpers. These existed as three copy-pasted variants
 * (generate route, useLaunchFlow add/retry, ResultsView ordering) before M14 —
 * one drifting copy would have silently broken ordering or calendar wording.
 */

/** Order plan items by their channel's rank in the strategy (unknown ids last,
 *  original order preserved among them). */
export function orderByRecommendation<T extends { platformId: string }>(
  items: T[],
  recommendations?: PlatformRecommendation[]
): T[] {
  if (!recommendations?.length) return items;
  const rank = new Map(recommendations.map((r, i) => [r.platformId, i]));
  return [...items].sort(
    (a, b) => (rank.get(a.platformId) ?? Infinity) - (rank.get(b.platformId) ?? Infinity)
  );
}

/** The canonical calendar entry for posting to a platform — single source of
 *  the action wording used by the server schedule and client add/retry paths. */
export function scheduleEntryFor(platform: PlatformDef): ScheduleItem {
  return {
    day: platform.defaultDay,
    platformId: platform.id,
    platformName: platform.name,
    action: `Post to ${platform.name} — ${platform.blurb} (${platform.bestTime})`,
  };
}

/** Insert schedule items keeping the by-day sort the calendar relies on. */
export function sortSchedule(schedule: ScheduleItem[]): ScheduleItem[] {
  return [...schedule].sort((a, b) => a.day - b.day);
}
