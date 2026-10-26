import { productTrialEntry, trialProductFacts } from "./opportunityResearch";
import type { Fact, ProductProfile, TrialResearchInput } from "./types";

/** Editable workflow suggestions, not assertions about unobserved product controls.
 * Seed once when this project mounts; never replace a user's edited Brief. */
export function createTrialBrief(
  profile: ProductProfile,
  productUrl: string
): TrialResearchInput {
  let entryUrl = "";
  try {
    entryUrl = productTrialEntry(productUrl);
  } catch {
    // The form keeps invalid/private entries empty until the user supplies a public URL.
  }
  return {
    mode: "product-led",
    audience: profile.audience.slice(0, 500),
    task: `Try one documented workflow in ${profile.name} and report one confusing step`.slice(
      0,
      500
    ),
    entryUrl,
    platformId: "twitter",
    venue: "Own X profile",
    steps: [
      "Open the product entry and choose a documented workflow",
      "Complete one small task using sample or non-sensitive data",
      "Describe the result and one confusing step; do not share private data",
    ],
    feedbackQuestion: "Which step was hardest to understand, and what did you expect?",
    sources: [],
  };
}

/** Useful proof labels only; unavailable/untested facts never become evidence. */
export function briefFactReferences(facts: Fact[]): { id: string; claim: string }[] {
  return trialProductFacts(facts)
    .slice(0, 3)
    .map(({ id, claim }) => ({ id, claim }));
}
