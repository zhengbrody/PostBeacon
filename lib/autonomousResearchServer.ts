import { PublicError } from "./errors";
import { searchApprovedPublicSources } from "./search";
import { runOpportunityResearch } from "./opportunityResearchServer";
import {
  normalizeResearchInput,
  productTrialEntry,
  trialProductFacts,
} from "./opportunityResearch";
import {
  autonomousSourceUrl,
  containsPrivateResearchText,
  normalizeAutonomousSearch,
  type AutonomousSearchReceipt,
} from "./autonomousResearch";
import type {
  Fact,
  OpportunityResearch,
  OpportunitySource,
  ProductProfile,
  SuccessContract,
  TrialResearchInput,
} from "./types";

export interface AutonomousResearchArgs {
  provider: "openai";
  productUrl: string;
  profile: ProductProfile;
  facts: Fact[];
  successContract: SuccessContract;
  input: TrialResearchInput;
  bannedClaims?: string[];
  search: { queries: string[]; domains: string[] };
}

/** A single bounded search batch followed by independently fetched quote checks.
 * Progress callbacks must atomically reserve/fence the owning task before spend.
 * The caller persists only this minimal receipt and the normal research result. */
export async function runAutonomousResearch(
  args: AutonomousResearchArgs,
  progress: {
    beforeSearch: () => Promise<void>;
    sources: (sources: OpportunitySource[]) => Promise<void>;
    beforeModel: () => Promise<void>;
  }
): Promise<{ research?: OpportunityResearch; search: AutonomousSearchReceipt }> {
  if (args.provider !== "openai")
    throw new PublicError(
      "Daily public research currently requires explicit OpenAI processing approval. Other providers are not enabled."
    );
  const search = normalizeAutonomousSearch(args.search);
  const brief = normalizeResearchInput(args.input);
  if (!search || !brief || brief.mode !== "product-led" || brief.sources.length)
    throw new PublicError(
      "Approve public search terms, exact domains and a source-free product Brief first."
    );
  const facts = trialProductFacts(args.facts).slice(0, 20);
  if (!facts.length)
    throw new PublicError("Confirm product facts before requesting public research.");
  const productUrl = productTrialEntry(args.productUrl);
  if (new URL(brief.entryUrl).origin !== new URL(productUrl).origin)
    throw new PublicError("The approved trial must use the product's own origin.");
  if (new URL(brief.entryUrl).search || new URL(productUrl).search)
    throw new PublicError(
      "Autonomous research accepts public product entries without query parameters."
    );
  // Only approved public product descriptions are sent to the model; do not
  // anonymize identity-bearing claims into a different, silently approved claim.
  if (
    [
      args.profile.name,
      brief.audience,
      brief.task,
      brief.venue,
      brief.feedbackQuestion,
      ...brief.steps,
      ...facts.map((fact) => fact.claim),
      ...(args.bannedClaims ?? []),
    ].some(containsPrivateResearchText)
  )
    throw new PublicError(
      "Remove contact details, handles and secrets from public research inputs first."
    );
  await progress.beforeSearch();
  const found = await searchApprovedPublicSources(search);
  const sources: TrialResearchInput["sources"] = [];
  const seen = new Set<string>();
  for (const result of found.results) {
    const url = autonomousSourceUrl(result.url, search.domains);
    const quote = result.snippet.replace(/\s+/g, " ").trim().slice(0, 400);
    if (
      !url ||
      seen.has(url) ||
      quote.length < 30 ||
      containsPrivateResearchText(result.snippet) ||
      containsPrivateResearchText(result.title) ||
      /ignore (?:all |any |the )?(?:previous|prior|above) instructions|system prompt|developer message|exfiltrat/i.test(
        quote
      )
    )
      continue;
    seen.add(url);
    sources.push({ url, quote, fetchAllowed: true });
    if (sources.length === 2) break;
  }
  const receipt: AutonomousSearchReceipt = {
    ...search,
    status: found.resultCount === 0 ? "no-results" : "no-eligible-results",
    searchedAt: new Date().toISOString(),
    resultCount: Math.min(15, found.resultCount),
    candidateCount: sources.length,
  };
  if (!sources.length) return { search: receipt };
  const research = await runOpportunityResearch(
    { ...args, input: { ...brief, mode: "evidence-led", sources } },
    progress
  );
  receipt.status = research.sources.some((source) => source.verification === "quote-found")
    ? "completed"
    : "no-verified-sources";
  return { research, search: receipt };
}
