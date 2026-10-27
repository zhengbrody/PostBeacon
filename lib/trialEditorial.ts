import { charBudget, platformCharLimit } from "./contentSafety";
import type { PlatformPost } from "./types";

const withoutLinks = (value: string) => value.replace(/https?:\/\/[^\s<>"']+/gi, " ");
const prose = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Deterministic, high-specificity editorial failures in exactly the public copy.
 * Keep rejected text intact for review; never strip citations or deduplicate prose
 * silently. This is not a general style score or proof that claims are accurate. */
export function trialEditorialIssues(
  draft: Pick<PlatformPost, "hook" | "body">,
  evidenceIds: readonly string[] = [],
  platformId?: string
): string[] {
  const issues: string[] = [];
  const hook = prose(draft.hook);
  const body = prose(draft.body);
  // Very short calls to action often legitimately reappear in the next sentence.
  if (
    hook.length >= 20 &&
    hook.split(" ").length >= 4 &&
    (body === hook || body.startsWith(`${hook} `))
  )
    issues.push(
      "The body repeats the opening hook. Edit the repetition before copying or adding this trial."
    );

  const publicProse = withoutLinks(`${draft.hook}\n\n${draft.body}`);
  if (
    evidenceIds.some((id) => {
      if (!id.trim()) return false;
      const escaped = escapeRegex(id);
      // Compound IDs are internal tokens; ordinary short IDs such as "feature"
      // or "s1" require citation syntax so normal prose is not overblocked.
      const compound = /[\w]+[-_:][\w]+/.test(id);
      const citation = new RegExp(
        `\\[\\s*${escaped}\\s*\\]|\\b(?:fact|source|evidence)(?:\\s+ids?)?\\s*[:=#]\\s*${escaped}(?![\\p{L}\\p{N}_-])`,
        "iu"
      );
      return (
        citation.test(publicProse) ||
        (compound &&
          new RegExp(`(?<![\\p{L}\\p{N}_-])${escaped}(?![\\p{L}\\p{N}_-])`, "iu").test(
            publicProse
          ))
      );
    })
  )
    issues.push(
      "Internal evidence IDs appear in the invitation. Keep citations in the evidence panel, not public copy."
    );

  const limit = platformCharLimit(platformId);
  if (limit && !charBudget(draft, limit).fitsThread)
    issues.push(
      "A public-copy segment exceeds this channel's character limit. Shorten it or split it before copying."
    );
  return issues;
}
