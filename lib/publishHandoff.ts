import { auditDraftSafety, charBudget, platformCharLimit } from "./contentSafety";
import { publishDestination } from "./execution";
import { PLATFORMS } from "./platforms";
import type { Fact, PlatformPost, ProductProfile } from "./types";

/** Conservative application URL budget, not a platform/browser guarantee. */
const MAX_COMPOSE_URL_LENGTH = 1536;
const X_INTENT = "https://twitter.com/intent/tweet";

export type PublishHandoff =
  | {
      kind: "prefilled-compose";
      href: string;
      text: string;
      privacyNotice: string;
      reason: string;
    }
  | {
      kind: "copy-and-open";
      href: string;
      text: string;
      privacyNotice: string;
      reason: string;
    }
  | {
      kind: "unavailable";
      reason: string;
    };

/**
 * Projects a reviewed draft into a user-initiated handoff, never a publication.
 * No credentials, fetch, state mutation, inferred destination or silent clipping.
 * X's official publish widget uses /intent/tweet. Reddit's API submit contract
 * does not establish a supported text-prefill web URL, so it stays copy-and-open.
 */
export function buildPublishHandoff({
  platformId,
  post,
  facts,
  profile,
}: {
  platformId: string;
  post: Pick<PlatformPost, "hook" | "body">;
  facts: Fact[];
  profile: ProductProfile;
}): PublishHandoff {
  if (!PLATFORMS.some((platform) => platform.id === platformId)) {
    return { kind: "unavailable", reason: "No verified destination for this channel." };
  }
  const destination = publishDestination(platformId);
  if (!destination) {
    return { kind: "unavailable", reason: "No verified destination for this channel." };
  }
  const text = `${post.hook}\n\n${post.body}`;
  if (!text.trim()) {
    return { kind: "unavailable", reason: "Write a draft before opening the platform." };
  }
  const safety = auditDraftSafety(post, facts, profile, platformId);
  if (!safety.ready) {
    return {
      kind: "unavailable",
      reason: "Truth check blocked handoff — repair the highlighted draft issues first.",
    };
  }

  const manual = (reason: string): PublishHandoff => ({
    kind: "copy-and-open",
    href: destination,
    text,
    privacyNotice:
      "Opening the platform does not send the draft in the URL. Copying puts it on your clipboard; paste and review it on the platform. PostBeacon does not publish it or add account tokens.",
    reason,
  });
  if (platformId !== "twitter") {
    return manual("Copy the draft, open the platform and review before posting.");
  }
  const limit = platformCharLimit(platformId);
  if (!limit || !charBudget(post, limit).fitsSingle) {
    return manual(
      "This draft needs a thread. Copy the complete draft and split it on X; no segment is sent or removed automatically."
    );
  }
  // The shared gate counts UTF-16 units. This deliberately stricter bound avoids
  // claiming that CJK text/emoji fits X's weighted limit; it is not a replacement
  // for X's final composer validation and does not strip or rewrite any character.
  const conservativeLength = Array.from(text).reduce(
    (length, character) => length + (character.charCodeAt(0) <= 0x7f ? 1 : 2),
    0
  );
  if (conservativeLength > limit) {
    return manual(
      "The draft may exceed X's weighted single-post limit. Copy the complete draft and review the length on X."
    );
  }
  const url = new URL(X_INTENT);
  url.search = new URLSearchParams({ text }).toString();
  if (url.href.length > MAX_COMPOSE_URL_LENGTH) {
    return manual(
      "The prefilled URL would be too long. Copy the complete draft and paste it on X instead."
    );
  }
  return {
    kind: "prefilled-compose",
    href: url.href,
    text,
    privacyNotice:
      "Opening X sends this draft to X in the URL, which may remain in browser history. PostBeacon does not add account tokens. Review the draft and press Post on X yourself; opening it does not publish it.",
    reason: "Review this draft in X's composer. It is not published automatically.",
  };
}
