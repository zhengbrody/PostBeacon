import { trialPublicationIssues } from "./opportunityResearch";
import type { PlannedExperiment, PlatformPost } from "./types";

/** Every draft exit uses the same reviewed-trial constraints, including the library.
 * Match the actual draft identity, not merely the currently focused Today card. */
export function trialDraftIssues(
  platformId: string,
  postIdx: number,
  post: Pick<PlatformPost, "hook" | "body">,
  plans: readonly PlannedExperiment[] = [],
  currentContextKey?: string,
  bannedClaims: readonly string[] = []
): string[] {
  const issues: string[] = [];
  for (const plan of plans) {
    if (
      plan.status === "cancelled" ||
      plan.platformId !== platformId ||
      plan.postIdx !== postIdx ||
      !plan.opportunity
    )
      continue;
    const trial = plan.opportunity;
    if (
      (trial.contextKey && trial.contextKey !== currentContextKey) ||
      (trial.mode === "product-led" && !trial.contextKey)
    )
      issues.push(
        "Product facts or the success goal changed. Prepare and review a fresh trial kit first."
      );
    issues.push(...trialPublicationIssues(trial, post, [...bannedClaims]));
  }
  return [...new Set(issues)];
}
