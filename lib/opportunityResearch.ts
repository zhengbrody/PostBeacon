import { z } from "zod";
import { asRecord, asRecordList, asString } from "./coerce";
import { assertPublicHttpUrl } from "./urlPolicy";
import { auditDraftSafety } from "./contentSafety";
import { PLATFORMS } from "./platforms";
import { trialEditorialIssues } from "./trialEditorial";
import type {
  Fact,
  OpportunityResearch,
  OpportunitySource,
  ProductProfile,
  PlatformPost,
  SuccessContract,
  TrialOpportunitySnapshot,
  TrialResearchInput,
} from "./types";

const text = (max: number) => z.string().trim().min(1).max(max);
export const trialResearchInputSchema = z
  .object({
    mode: z.enum(["product-led", "evidence-led"]).optional(),
    audience: text(500),
    task: text(500),
    entryUrl: text(2048),
    platformId: text(64).refine(
      (id) => PLATFORMS.some((p) => p.id === id),
      "unknown platform"
    ),
    venue: text(200),
    steps: z.tuple([text(200), text(200), text(200)]),
    feedbackQuestion: text(300),
    sources: z
      .array(
        z.object({
          url: text(2048),
          quote: z.string().trim().min(30).max(400),
          fetchAllowed: z.boolean(),
        })
      )
      .max(3),
  })
  .superRefine((input, ctx) => {
    if (
      input.mode === "product-led" ? input.sources.length !== 0 : input.sources.length < 1
    )
      ctx.addIssue({
        code: "custom",
        path: ["sources"],
        message:
          "Product-led trials use no demand sources; evidence-led trials require one to three.",
      });
  });

function boundedFactIds(raw: unknown): string[] {
  return Array.isArray(raw)
    ? [
        ...new Set(
          raw.filter(
            (id): id is string =>
              typeof id === "string" && Boolean(id.trim()) && id.length <= 60
          )
        ),
      ].slice(0, 6)
    : [];
}

/** Exact public URL, never credentials, local/private literals or token links. */
export function researchUrl(raw: string): string {
  const url = assertPublicHttpUrl(raw);
  if (
    [...url.searchParams.keys()].some((key) =>
      /token|secret|password|api.?key|auth|code/i.test(key)
    )
  ) {
    throw new Error("Private-link parameters are not accepted.");
  }
  url.hash = "";
  return url.toString();
}

/** Existing analyzed projects may store a bare hostname; source URLs remain strict. */
export function productTrialEntry(raw: string): string {
  const value = raw.trim();
  return researchUrl(
    /^[\w.-]+\.[a-z]{2,}(?:[/?#]|$)/i.test(value) ? `https://${value}` : value
  );
}

export function normalizeResearchInput(raw: unknown): TrialResearchInput | undefined {
  const parsed = trialResearchInputSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  try {
    const input = parsed.data;
    const sources = input.sources.map((source) => ({
      ...source,
      url: researchUrl(source.url),
      quote: source.quote.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email removed]"),
    }));
    if (new Set(sources.map((s) => s.url)).size !== sources.length) return undefined;
    return { ...input, sources, entryUrl: researchUrl(input.entryUrl) };
  } catch {
    return undefined;
  }
}

/** Exact version comparison, not a security hash or model confidence score. */
export function researchContextKey(
  profile: ProductProfile,
  facts: Fact[],
  contract: SuccessContract | undefined,
  productUrl: string,
  bannedClaims: string[] = []
): string {
  return JSON.stringify({
    productUrl,
    bannedClaims: [...bannedClaims].sort(),
    profile: Object.fromEntries(
      Object.entries(profile).sort(([a], [b]) => a.localeCompare(b))
    ),
    facts: facts
      .map(
        ({
          id,
          field,
          claim,
          evidence,
          sourceUrl,
          sourceType,
          status,
          confidence,
          lastVerifiedAt,
        }) => ({
          id,
          field,
          claim,
          evidence,
          sourceUrl,
          sourceType,
          status,
          confidence,
          lastVerifiedAt,
        })
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
    contract: contract
      ? Object.fromEntries(Object.entries(contract).sort(([a], [b]) => a.localeCompare(b)))
      : null,
  });
}

export function eligibleSource(source: OpportunitySource): boolean {
  return source.verification === "user-provided" || source.verification === "quote-found";
}

/** Launch preferences are not evidence that a product can perform a task. */
export function trialProductFacts(facts: Fact[]): Fact[] {
  return facts.filter(
    (fact) =>
      (fact.status === "observed" || fact.status === "user-confirmed") &&
      Boolean(fact.claim.trim()) &&
      !["conversionGoal", "stage", "assets"].includes(fact.field ?? "")
  );
}

/** A saved receipt is bounded content, not an instruction or executable URL. */
export function normalizeOpportunityResearch(
  raw: unknown
): OpportunityResearch | undefined {
  const item = asRecord(raw),
    input = normalizeResearchInput(item.input);
  const id = asString(item.id).slice(0, 80),
    contextKey = asString(item.contextKey);
  if (!input || !id || !contextKey || contextKey.length > 80_000) return undefined;
  const seen = new Set<string>();
  const sources: OpportunitySource[] = asRecordList(item.sources)
    .slice(0, 3)
    .flatMap((source) => {
      const sourceId = asString(source.id).slice(0, 80);
      const verification = asString(
        source.verification
      ) as OpportunitySource["verification"];
      if (
        !sourceId ||
        seen.has(sourceId) ||
        !["user-provided", "quote-found", "quote-not-found", "fetch-failed"].includes(
          verification
        )
      )
        return [];
      const submitted = input.sources.find(
        (candidate) => candidate.url === source.url && candidate.quote === source.quote
      );
      if (!submitted) return [];
      seen.add(sourceId);
      return [
        {
          id: sourceId,
          url: submitted.url,
          quote: submitted.quote,
          verification,
          checkedAt: asString(source.checkedAt).slice(0, 40),
          title: asString(source.title).slice(0, 200) || undefined,
          truncated: source.truncated === true,
          rules: "unknown",
        },
      ];
    });
  const used = new Set<string>();
  const productLed = input.mode === "product-led";
  const opportunities = asRecordList(item.opportunities)
    .slice(0, productLed ? 1 : 3)
    .flatMap((candidate) => {
      const sourceId = asString(candidate.sourceId),
        draft = asRecord(candidate.draft);
      const source = sources.find((s) => s.id === sourceId && eligibleSource(s));
      const factIds = boundedFactIds(candidate.factIds);
      if (
        (productLed ? Boolean(sourceId) || !factIds.length : !source) ||
        used.has(sourceId) ||
        typeof draft.hook !== "string" ||
        typeof draft.body !== "string"
      )
        return [];
      used.add(sourceId);
      return [
        {
          id: productLed ? `${id}:product` : `${id}:${sourceId}`,
          ...(productLed ? {} : { sourceId }),
          whyFit: asString(candidate.whyFit).slice(0, 700),
          factIds,
          draft: {
            hook: draft.hook.slice(0, 1000),
            body: draft.body.slice(0, 4000),
            imageSuggestion:
              "Use real product screenshots from the three trial steps; hide private data.",
            bestTime: "Choose manually; no timing claim was verified.",
            caveats:
              "Proposed invitation. Review product facts, trial instructions and venue rules before publishing.",
          },
        },
      ];
    });
  const meta = asRecord(item.meta);
  return {
    id,
    contextKey,
    input,
    sources,
    opportunities,
    completedAt: asString(item.completedAt).slice(0, 40),
    ...(meta.provider === "openai" || meta.provider === "deepseek"
      ? { meta: { provider: meta.provider, model: asString(meta.model).slice(0, 80) } }
      : {}),
    ...(item.example === true ? { example: true } : {}),
  };
}

export function trialSafety(
  research: OpportunityResearch,
  opportunityId: string,
  facts: Fact[],
  profile: ProductProfile,
  bannedClaims: string[] = []
): string[] {
  const opportunity = research.opportunities.find((o) => o.id === opportunityId);
  if (!opportunity) return ["The selected opportunity is no longer available."];
  const confirmed = new Set(trialProductFacts(facts).map((f) => f.id));
  const issues = auditDraftSafety(
    opportunity.draft,
    facts,
    profile,
    research.input.platformId
  ).issues.map((issue) => issue.title);
  if (research.input.mode === "product-led") {
    if (research.input.sources.length || research.sources.length || opportunity.sourceId)
      issues.push("A product-led trial cannot claim external demand evidence.");
  } else if (
    !research.sources.some(
      (source) => source.id === opportunity.sourceId && eligibleSource(source)
    )
  ) {
    issues.push("The invitation needs an eligible submitted demand source.");
  }
  if (!opportunity.factIds.length || opportunity.factIds.some((id) => !confirmed.has(id)))
    issues.push("The invitation needs a current verified or user-confirmed product fact.");
  const instructionSafety = auditDraftSafety(
    {
      hook: research.input.task,
      body: [...research.input.steps, research.input.feedbackQuestion].join("\n"),
    },
    facts,
    profile
  );
  issues.push(...instructionSafety.issues.map((issue) => issue.title));
  issues.push(
    ...trialPublicationIssues(
      {
        ...research.input,
        factIds: opportunity.factIds,
        source: research.sources.find((source) => source.id === opportunity.sourceId),
      },
      opportunity.draft,
      bannedClaims,
      research.input.platformId
    )
  );
  return [...new Set(issues)];
}

/** Re-run after queued drafts are edited; approved entry/claim boundaries persist. */
export function trialPublicationIssues(
  trial: Pick<
    TrialOpportunitySnapshot,
    "entryUrl" | "task" | "steps" | "feedbackQuestion"
  > &
    Partial<Pick<TrialOpportunitySnapshot, "factIds" | "source">>,
  draft: Pick<PlatformPost, "hook" | "body">,
  bannedClaims: string[] = [],
  platformId?: string
): string[] {
  const issues = trialEditorialIssues(
    draft,
    [...(trial.factIds ?? []), ...(trial.source ? [trial.source.id] : [])],
    platformId
  );
  const proposedText = [
    draft.hook,
    draft.body,
    trial.task,
    ...trial.steps,
    trial.feedbackQuestion,
  ]
    .join("\n")
    .toLocaleLowerCase();
  if (
    bannedClaims.some(
      (claim) => claim.trim() && proposedText.includes(claim.trim().toLocaleLowerCase())
    )
  )
    issues.push("The trial kit contains a claim you marked as never to use.");
  const links = `${draft.hook}\n${draft.body}`.match(/https?:\/\/[^\s<>"')]+/gi) ?? [];
  if (
    links.some((link) => {
      try {
        return researchUrl(link) !== trial.entryUrl;
      } catch {
        return true;
      }
    })
  )
    issues.push("The invitation contains an entry link that you did not approve.");
  if (!draft.body.includes(trial.entryUrl))
    issues.push("The approved product entry link is missing.");
  return [...new Set(issues)];
}

export function normalizeTrialSnapshot(raw: unknown): TrialOpportunitySnapshot | undefined {
  const item = asRecord(raw),
    source = asRecord(item.source);
  try {
    const steps = item.steps;
    if (
      !Array.isArray(steps) ||
      steps.length !== 3 ||
      steps.some((s) => typeof s !== "string" || !s.trim() || s.length > 200)
    )
      return undefined;
    if (
      item.mode !== undefined &&
      item.mode !== "product-led" &&
      item.mode !== "evidence-led"
    )
      return undefined;
    const productLed = item.mode === "product-led";
    const factIds = boundedFactIds(item.factIds);
    const contextKey = asString(item.contextKey);
    if ((productLed && !contextKey.trim()) || contextKey.length > 50_000) return undefined;
    const verification = asString(source.verification) as OpportunitySource["verification"];
    if (
      productLed
        ? item.source !== undefined || !factIds.length
        : !["user-provided", "quote-found"].includes(verification)
    )
      return undefined;
    const researchId = asString(item.researchId).slice(0, 80),
      rulesUserCheckedAt = asString(item.rulesUserCheckedAt).slice(0, 40);
    const audience = asString(item.audience).trim().slice(0, 500);
    if (
      !researchId ||
      !rulesUserCheckedAt ||
      (!productLed && !asString(source.id)) ||
      !audience ||
      !asString(item.task).trim() ||
      !asString(item.feedbackQuestion).trim() ||
      (!productLed && asString(source.quote).trim().length < 30)
    )
      return undefined;
    return {
      researchId,
      audience,
      ...(contextKey ? { contextKey } : {}),
      ...(item.mode === undefined ? {} : { mode: item.mode }),
      ...(factIds.length ? { factIds } : {}),
      ...(productLed
        ? {}
        : {
            source: {
              id: asString(source.id).slice(0, 80),
              url: researchUrl(asString(source.url)),
              quote: asString(source.quote).slice(0, 400),
              verification,
              checkedAt: asString(source.checkedAt).slice(0, 40),
              rules: "unknown",
              title: asString(source.title).slice(0, 200) || undefined,
              truncated: source.truncated === true,
            },
          }),
      task: asString(item.task).slice(0, 500),
      entryUrl: researchUrl(asString(item.entryUrl)),
      steps: [asString(steps[0]), asString(steps[1]), asString(steps[2])],
      feedbackQuestion: asString(item.feedbackQuestion).slice(0, 300),
      rulesUserCheckedAt,
    };
  } catch {
    return undefined;
  }
}

/** Fictional walkthrough, always labelled and never submitted to a provider. */
export function exampleOpportunityResearch(
  profile: ProductProfile,
  facts: Fact[],
  contract: SuccessContract,
  productUrl: string,
  bannedClaims: string[] = [],
  inputOverride?: TrialResearchInput
): OpportunityResearch {
  const fact = trialProductFacts(facts)[0];
  const entryUrl = productTrialEntry(productUrl);
  const input: TrialResearchInput = inputOverride ?? {
    audience: "Independent developers in this fictional example",
    task: "Try the example workflow and report one confusing step",
    entryUrl,
    platformId: "twitter",
    venue: "Example X profile — fictional",
    steps: [
      "Open the example product entry",
      "Try the documented workflow using sample data",
      "Share one confusing step; do not paste private data",
    ],
    feedbackQuestion: "Which step was hardest to understand?",
    sources: [
      {
        url: "https://example.org/product-feedback",
        quote:
          "Fictional example: a developer asks for a clearer way to check whether a scheduled job ran.",
        fetchAllowed: false,
      },
    ],
  };
  const id = "fictional-trial-research";
  const research = normalizeOpportunityResearch({
    id,
    contextKey: researchContextKey(profile, facts, contract, productUrl, bannedClaims),
    input,
    sources:
      input.mode === "product-led"
        ? []
        : [
            {
              id: "s1",
              ...input.sources[0],
              verification: "user-provided",
              checkedAt: new Date().toISOString(),
              rules: "unknown",
            },
          ],
    opportunities: [
      {
        ...(input.mode === "product-led" ? {} : { sourceId: "s1" }),
        whyFit:
          input.mode === "product-led"
            ? "Product-fact trial only. No external demand evidence or venue permission has been verified."
            : "Fictional fit hypothesis only; no real community, demand or permission has been verified.",
        factIds: fact ? [fact.id] : [],
        draft: {
          hook:
            input.mode === "product-led"
              ? input.task
              : `Try ${profile.name} with one small task.`,
          body: `${fact?.claim ?? profile.name}\n\n${input.feedbackQuestion}\n\n${input.entryUrl}`,
        },
      },
    ],
    completedAt: new Date().toISOString(),
    example: true,
  });
  if (!research) throw new Error("The fictional trial example could not be normalized.");
  return research;
}
