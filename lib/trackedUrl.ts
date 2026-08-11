import { isSafeExternalHref } from "./urlPolicy";

/** Normalize an optional live-post URL for navigation or persistence. Invalid,
 * relative and non-http(s) values become absent instead of executable hrefs. */
export function normalizeTrackedUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value || !isSafeExternalHref(value)) return undefined;
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}
