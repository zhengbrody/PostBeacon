import { beforeEach, describe, expect, it, vi } from "vitest";
import { flowReducer, initialFlowState, type FlowState } from "@/hooks/launchFlowReducer";
import { DEMO_PROJECT } from "@/lib/demo";
import {
  normalizeOpportunityResearch,
  normalizeResearchInput,
  researchContextKey,
  researchUrl,
  trialSafety,
  exampleOpportunityResearch,
} from "@/lib/opportunityResearch";
import {
  runOpportunityResearch,
  sourceFetchPermitted,
} from "@/lib/opportunityResearchServer";
import { toJson, toMarkdown } from "@/lib/export";
import { migrateDraft } from "@/lib/storage";
import { deriveToday } from "@/lib/today";
import { normalizePlannedExperiments } from "@/lib/experimentQueue";
import type {
  Fact,
  OpportunityResearch,
  SuccessContract,
  TrialResearchInput,
} from "@/lib/types";

const calls = vi.hoisted(() => ({ model: vi.fn(), scrape: vi.fn() }));
vi.mock("@/lib/llm", () => ({ generateJsonOnce: calls.model }));
vi.mock("@/lib/scrape", () => ({ scrapeStaticSource: calls.scrape }));

const at = "2026-10-12T00:00:00.000Z";
const contract: SuccessContract = {
  primaryGoal: "Useful feedback",
  primarySignal: "replies",
  minimumResult: 2,
  evaluationWindow: "72h",
};
const facts: Fact[] = [
  {
    id: "feature",
    field: "features",
    claim: "Acme checks scheduled jobs.",
    sourceType: "user",
    status: "user-confirmed",
    confidence: 1,
    lastVerifiedAt: at,
  },
];
const profile = {
  ...DEMO_PROJECT.profile,
  name: "Acme",
  audience: "Independent developers",
  publisherVoice: "brand" as const,
  features: [facts[0].claim],
  conversionGoal: contract.primaryGoal,
};
const input: TrialResearchInput = {
  audience: "Independent developers",
  task: "Try one scheduled job check",
  entryUrl: "https://acme.example/demo",
  platformId: "twitter",
  venue: "Own X profile",
  steps: ["Open the demo", "Inspect one sample job", "Tell the author what was unclear"],
  feedbackQuestion: "Which step was unclear?",
  sources: [
    {
      url: "https://example.org/need",
      quote: "How can a developer tell whether a scheduled job actually ran?",
      fetchAllowed: false,
    },
  ],
};
const invitation = {
  sourceId: "s1",
  whyFit: "A tentative overlap with job monitoring; venue suitability is unknown.",
  factIds: ["feature"],
  hook: "Try one scheduled job check.",
  body: "Acme checks scheduled jobs.\n\nWhich step was unclear?\n\nhttps://acme.example/demo",
};
const args = () => ({
  provider: "openai" as const,
  productUrl: "https://acme.example",
  profile,
  facts,
  successContract: contract,
  input: structuredClone(input),
});
beforeEach(() => {
  vi.clearAllMocks();
  calls.model.mockResolvedValue({
    data: { opportunities: [invitation] },
    meta: { provider: "openai", model: "test-model" },
  });
  calls.scrape.mockResolvedValue({ text: input.sources[0].quote, textTruncated: false });
});

describe("bounded, source-first opportunity research", () => {
  it("supports the actual hostname-only fictional project without model calls", () => {
    const research = exampleOpportunityResearch(
      DEMO_PROJECT.profile,
      DEMO_PROJECT.facts,
      contract,
      DEMO_PROJECT.url
    );
    expect(research.input.entryUrl).toBe("https://cronwise.dev/");
    expect(research.example).toBe(true);
    expect(
      trialSafety(
        research,
        research.opportunities[0].id,
        DEMO_PROJECT.facts,
        DEMO_PROJECT.profile
      )
    ).toEqual([]);
    expect(calls.model).not.toHaveBeenCalled();
    expect(calls.scrape).not.toHaveBeenCalled();
  });
  it("does not use confirmed launch goals as evidence of product capability", async () => {
    const request = args();
    request.facts = [
      { ...facts[0], field: "conversionGoal", claim: "Get useful feedback" },
    ];
    await expect(runOpportunityResearch(request)).rejects.toMatchObject({ status: 400 });
    expect(calls.model).not.toHaveBeenCalled();
    expect(calls.scrape).not.toHaveBeenCalled();
  });
  it("transfers only bounded banned claims and includes them in the context version", async () => {
    const research = await runOpportunityResearch({
      ...args(),
      bannedClaims: ["guaranteed results"],
    });
    expect(JSON.parse(calls.model.mock.calls[0][0].user).claimsNeverToUse).toEqual([
      "guaranteed results",
    ]);
    expect(research.contextKey).not.toBe(
      researchContextKey(profile, facts, contract, args().productUrl)
    );
  });
  it("uses only submitted excerpts by default and labels fit as a hypothesis", async () => {
    const research = await runOpportunityResearch(args());
    expect(calls.scrape).not.toHaveBeenCalled();
    expect(calls.model).toHaveBeenCalledOnce();
    expect(calls.model.mock.calls[0][0]).toMatchObject({
      provider: "openai",
      maxTokens: 2600,
    });
    expect(research.sources[0]).toMatchObject({
      verification: "user-provided",
      quote: input.sources[0].quote,
      rules: "unknown",
    });
    expect(research.opportunities[0].factIds).toEqual(["feature"]);
    expect(research.input.venue).not.toBe(research.sources[0].url);
    expect(trialSafety(research, research.opportunities[0].id, facts, profile)).toEqual([]);
  });
  it("verifies an exact whitespace-normalized quote only when fetching was allowed", async () => {
    const request = args();
    request.input.sources[0].fetchAllowed = true;
    calls.scrape.mockResolvedValue({
      text: `Public page\n${input.sources[0].quote.replaceAll(" ", "\n")}`,
      textTruncated: true,
    });
    const research = await runOpportunityResearch(request);
    expect(calls.scrape).toHaveBeenCalledOnce();
    expect(research.sources[0]).toMatchObject({
      verification: "quote-found",
      truncated: true,
      rules: "unknown",
    });
    expect(research.sources[0]).not.toHaveProperty("publicationDate");
  });
  it.each(["not-found", "fetch-failed"])(
    "makes no model call if the only source is %s",
    async (mode) => {
      const request = args();
      request.input.sources[0].fetchAllowed = true;
      if (mode === "not-found")
        calls.scrape.mockResolvedValue({ text: "Different page", textTruncated: false });
      else calls.scrape.mockRejectedValue(new Error("secret upstream response"));
      const research = await runOpportunityResearch(request);
      expect(research.opportunities).toEqual([]);
      expect(research.meta).toBeUndefined();
      expect(calls.model).not.toHaveBeenCalled();
      expect(JSON.stringify(research)).not.toContain("secret upstream");
    }
  );
  it("drops unknown source IDs, unknown facts, duplicates and model-authored source claims", async () => {
    calls.model.mockResolvedValue({
      data: {
        opportunities: [
          { ...invitation, sourceId: "invented" },
          { ...invitation, factIds: ["invented"] },
          { ...invitation, rules: "allowed", quote: "fake quote" },
          invitation,
        ],
      },
      meta: { provider: "openai", model: "test-model" },
    });
    const research = await runOpportunityResearch(args());
    expect(research.opportunities).toHaveLength(1);
    expect(research.sources[0].quote).toBe(input.sources[0].quote);
    expect(research.sources[0].rules).toBe("unknown");
    expect(JSON.stringify(research)).not.toContain("fake quote");
  });
  it("can honestly return no opportunities instead of fallback inventions", async () => {
    calls.model.mockResolvedValue({
      data: { opportunities: [] },
      meta: { provider: "openai", model: "test-model" },
    });
    expect((await runOpportunityResearch(args())).opportunities).toEqual([]);
  });
  it.each([
    "http://127.0.0.1/a",
    "http://169.254.169.254/a",
    "javascript:alert(1)",
    "/relative",
    "https://example.org/a?token=secret",
  ])("rejects unsafe source %s before calls", async (url) => {
    const request = args();
    request.input.sources[0].url = url;
    await expect(runOpportunityResearch(request)).rejects.toMatchObject({ status: 400 });
    expect(calls.scrape).not.toHaveBeenCalled();
    expect(calls.model).not.toHaveBeenCalled();
  });
  it("preflights the entire source set before fetching any URL", async () => {
    const request = args();
    request.input.sources[0].fetchAllowed = true;
    request.input.sources.push({
      ...request.input.sources[0],
      url: "http://localhost/private",
    });
    await expect(runOpportunityResearch(request)).rejects.toMatchObject({ status: 400 });
    expect(calls.scrape).not.toHaveBeenCalled();
  });
  it.each([
    "https://reddit.com/r/a",
    "https://www.x.com/name",
    "https://old.reddit.com/r/a",
    "https://linkedin.com/posts/a",
  ])("does not generic-fetch restricted source %s", async (url) => {
    const request = args();
    request.input.sources[0] = { ...request.input.sources[0], url, fetchAllowed: true };
    expect(sourceFetchPermitted(url)).toBe(false);
    await expect(runOpportunityResearch(request)).rejects.toMatchObject({ status: 400 });
    expect(calls.scrape).not.toHaveBeenCalled();
    expect(calls.model).not.toHaveBeenCalled();
    request.input.sources[0].fetchAllowed = false;
    expect((await runOpportunityResearch(request)).sources[0].verification).toBe(
      "user-provided"
    );
  });
  it("does not transfer a product trial to another origin or use unknown-only product facts", async () => {
    const request = args();
    request.input.entryUrl = "https://other.example/demo";
    await expect(runOpportunityResearch(request)).rejects.toMatchObject({ status: 400 });
    request.input.entryUrl = input.entryUrl;
    request.facts = [{ ...facts[0], status: "inferred" }];
    await expect(runOpportunityResearch(request)).rejects.toMatchObject({ status: 400 });
    expect(calls.model).not.toHaveBeenCalled();
  });
  it("enforces three sources, unique URLs and obvious email removal before prompt/persistence", async () => {
    expect(
      normalizeResearchInput({ ...input, sources: Array(4).fill(input.sources[0]) })
    ).toBeUndefined();
    expect(
      normalizeResearchInput({ ...input, sources: [input.sources[0], input.sources[0]] })
    ).toBeUndefined();
    const request = args();
    request.input.sources[0].quote += " Contact private@example.com.";
    const research = await runOpportunityResearch(request);
    expect(JSON.stringify(research)).not.toContain("private@example.com");
    expect(calls.model.mock.calls[0][0].user).not.toContain("private@example.com");
  });
  it("does not persist full fetched page content and never enables rendering", async () => {
    const request = args();
    request.input.sources[0].fetchAllowed = true;
    calls.scrape.mockResolvedValue({
      text: `PRIVATE UNRELATED CORPUS ${input.sources[0].quote}`,
      textTruncated: false,
    });
    const research = await runOpportunityResearch(request);
    expect(JSON.stringify(research)).not.toContain("PRIVATE UNRELATED CORPUS");
    expect(calls.model.mock.calls[0][0].user).not.toContain("PRIVATE UNRELATED CORPUS");
  });
});

function seed(): FlowState {
  return flowReducer(initialFlowState, {
    type: "PROJECT_LOADED",
    demo: false,
    project: {
      ...DEMO_PROJECT,
      id: "owner-project",
      url: "https://acme.example",
      profile,
      facts,
      result: {
        content: [{ platformId: "twitter", platformName: "X / Twitter", posts: [] }],
        schedule: [],
      },
      workspace: { experiments: [], taskLog: [], successContract: contract },
    },
  });
}
function receipt(state: FlowState): OpportunityResearch {
  return normalizeOpportunityResearch({
    id: "research-one",
    contextKey: researchContextKey(
      state.profile!,
      state.facts,
      state.workspace.successContract,
      state.url
    ),
    input,
    sources: [
      {
        id: "s1",
        ...input.sources[0],
        verification: "user-provided",
        checkedAt: at,
        rules: "unknown",
      },
    ],
    opportunities: [
      { ...invitation, draft: { hook: invitation.hook, body: invitation.body } },
    ],
    completedAt: at,
  })!;
}
function withResearch(): FlowState {
  const state = seed();
  return flowReducer(state, {
    type: "OPPORTUNITY_RESEARCH_RECEIVED",
    projectId: state.projectId,
    research: receipt(state),
  });
}
const confirm = {
  type: "OPPORTUNITY_QUEUED" as const,
  researchId: "research-one",
  opportunityId: "research-one:s1",
  rulesUserChecked: true,
  trialUserChecked: true,
  at,
};

describe("review → confirm → independent trial execution", () => {
  it("still replaces a genuinely changed goal and rejects research for the old goal", () => {
    const state = withResearch();
    const restored = flowReducer(initialFlowState, {
      type: "PROJECT_LOADED",
      demo: false,
      project: {
        ...state,
        id: state.projectId,
        workspace: {
          ...state.workspace,
          successContract: { ...contract, primaryGoal: "Different goal" },
        },
      },
    });
    expect(restored.profile?.conversionGoal).toBe("Different goal");
    expect(restored.facts.find((fact) => fact.id === "conversionGoal")?.claim).toBe(
      "Different goal"
    );
    expect(flowReducer(restored, confirm).workspace.plannedExperiments ?? []).toHaveLength(
      0
    );
  });
  it("retains a truncated-source warning in confirmed trial provenance after hydration", () => {
    const pending = withResearch();
    pending.workspace.opportunityResearch!.sources[0].truncated = true;
    const queued = flowReducer(pending, confirm);
    const restored = flowReducer(initialFlowState, {
      type: "PROJECT_LOADED",
      demo: false,
      project: { ...queued, ...migrateDraft(JSON.parse(toJson(queued))) },
    });
    expect(restored.workspace.plannedExperiments?.[0].opportunity?.source?.truncated).toBe(
      true
    );
  });
  it.each(["flat", "meta"])(
    "keeps unchanged research confirmable after %s hydration",
    (kind) => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-10-23T10:00:00.000Z"));
        const state = withResearch();
        vi.setSystemTime(new Date("2026-10-23T11:00:00.000Z"));
        const restored = flowReducer(initialFlowState, {
          type: "PROJECT_LOADED",
          demo: false,
          project:
            kind === "flat"
              ? { ...state, id: state.projectId }
              : {
                  ...state,
                  id: state.projectId,
                  facts: undefined,
                  workspace: undefined,
                  meta: { facts: state.facts, workspace: state.workspace },
                },
        });
        expect(restored.facts).toEqual(state.facts);
        expect(flowReducer(restored, confirm).workspace.plannedExperiments).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    }
  );
  it("invalidates pending research when the evidence source changes without changing its claim", () => {
    const state = withResearch();
    const changed = {
      ...state,
      facts: state.facts.map((fact) => ({
        ...fact,
        sourceUrl: "https://acme.example/new-evidence",
      })),
    };
    expect(flowReducer(changed, confirm)).toEqual(changed);
  });
  it("rejects changed banned claims and literal banned text in a reviewed kit", () => {
    const state = withResearch();
    const changed = {
      ...state,
      memory: { ...state.memory, bannedClaims: ["scheduled jobs"] },
    };
    expect(flowReducer(changed, confirm)).toEqual(changed);
    expect(
      trialSafety(
        state.workspace.opportunityResearch!,
        confirm.opportunityId,
        state.facts,
        state.profile!,
        ["scheduled jobs"]
      )
    ).toContain("The trial kit contains a claim you marked as never to use.");
    const goal = [{ ...state.facts[0], field: "conversionGoal" }];
    expect(
      trialSafety(
        state.workspace.opportunityResearch!,
        confirm.opportunityId,
        goal,
        state.profile!
      )
    ).not.toEqual([]);
  });
  it("receiving research does not change drafts or queue", () => {
    const state = withResearch();
    expect(state.result!.content[0].posts).toEqual([]);
    expect(state.workspace.plannedExperiments ?? []).toEqual([]);
  });
  it("rejects stale account/project/evidence responses without disturbing the current plan", () => {
    const state = seed();
    const research = receipt(state);
    expect(
      flowReducer(state, {
        type: "OPPORTUNITY_RESEARCH_RECEIVED",
        projectId: "other-owner",
        research,
      })
    ).toEqual(state);
    const changed = {
      ...state,
      profile: { ...state.profile!, audience: "Different audience" },
    };
    expect(
      flowReducer(changed, {
        type: "OPPORTUNITY_RESEARCH_RECEIVED",
        projectId: state.projectId,
        research,
      })
    ).toEqual(changed);
    const reset = flowReducer(state, { type: "RESET" });
    expect(
      flowReducer(reset, {
        type: "OPPORTUNITY_RESEARCH_RECEIVED",
        projectId: state.projectId,
        research,
      }).workspace.opportunityResearch
    ).toBeUndefined();
  });
  it("requires both real-trial and venue-rule acknowledgements", () => {
    const state = withResearch();
    expect(flowReducer(state, { ...confirm, rulesUserChecked: false })).toEqual(state);
    expect(flowReducer(state, { ...confirm, trialUserChecked: false })).toEqual(state);
  });
  it("confirms exactly one ready draft into Today, not a published experiment", () => {
    const state = flowReducer(withResearch(), confirm);
    expect(state.workspace.experiments).toEqual([]);
    expect(state.workspace.plannedExperiments).toHaveLength(1);
    expect(state.result!.content[0].posts).toHaveLength(1);
    const plan = state.workspace.plannedExperiments![0];
    expect(plan).toMatchObject({
      status: "ready",
      sourceExperimentId: "",
      venue: "Own X profile",
      opportunity: { source: { url: input.sources[0].url, rules: "unknown" } },
    });
    expect(
      deriveToday(
        {
          workspace: state.workspace,
          result: state.result!,
          strategy: state.strategy,
          launchDate: "",
        },
        new Date(at)
      ).primaryAction.plannedExperimentId
    ).toBe(plan.id);
    expect(flowReducer(state, confirm)).toEqual(state);
  });
  it("rejects unsafe/overlong/invented copy and unauthorized links at confirmation", () => {
    for (const draft of [
      { hook: "I am an investor", body: invitation.body },
      { hook: "10k users joined", body: invitation.body },
      { hook: "a".repeat(281), body: invitation.body },
      { hook: invitation.hook, body: invitation.body + "\n\nhttps://evil.example/collect" },
    ]) {
      const state = withResearch();
      state.workspace.opportunityResearch!.opportunities[0].draft = {
        ...state.workspace.opportunityResearch!.opportunities[0].draft,
        ...draft,
      };
      expect(
        trialSafety(
          state.workspace.opportunityResearch!,
          confirm.opportunityId,
          state.facts,
          state.profile!
        )
      ).not.toEqual([]);
      expect(flowReducer(state, confirm)).toEqual(state);
    }
  });
  it("stale goals/facts and queue/draft capacity cannot silently append", () => {
    const state = withResearch();
    const changed = flowReducer(state, {
      type: "SUCCESS_CONTRACT_SET",
      contract: { ...contract, minimumResult: 4 },
    });
    expect(flowReducer(changed, confirm)).toEqual(changed);
    state.result!.content[0].posts = Array(12).fill({
      ...state.workspace.opportunityResearch!.opportunities[0].draft,
    });
    expect(flowReducer(state, confirm)).toEqual(state);
  });
  it("publish freezes trial provenance; discarding research cannot erase execution history", () => {
    let state = flowReducer(withResearch(), confirm);
    const plan = state.workspace.plannedExperiments![0];
    state = flowReducer(state, {
      type: "EXPERIMENT_CREATED",
      experiment: {
        id: "trial-execution",
        plannedExperimentId: plan.id,
        platformId: plan.platformId,
        platformName: plan.platformName,
        community: plan.venue,
        angle: plan.angle,
        variant: invitation.hook,
        hypothesis: "Get useful feedback",
        publishedAt: at,
        status: "live",
        postIdx: 0,
        outcomes: [],
      },
    });
    expect(state.workspace.experiments[0].opportunity?.source?.quote).toBe(
      input.sources[0].quote
    );
    expect(state.workspace.experiments[0].snapshot?.variable).toBe("exploratory");
    expect(state.workspace.experiments[0].snapshot?.audience).toBe(input.audience);
    state = flowReducer(state, { type: "OPPORTUNITY_RESEARCH_CLEARED" });
    expect(state.workspace.opportunityResearch).toBeUndefined();
    expect(state.workspace.experiments[0].opportunity?.steps).toEqual(input.steps);
    const exported = toJson({
      profile: state.profile,
      result: state.result,
      url: state.url,
      facts: state.facts,
      workspace: state.workspace,
    });
    const hydrated = flowReducer(initialFlowState, {
      type: "PROJECT_LOADED",
      demo: false,
      project: { ...state, ...migrateDraft(JSON.parse(exported)) },
    });
    expect(hydrated.workspace.plannedExperiments![0].opportunity?.source?.quote).toBe(
      input.sources[0].quote
    );
    const md = toMarkdown({
      profile: state.profile,
      result: state.result,
      workspace: state.workspace,
    });
    expect(md).toContain(input.steps[1]);
    expect(md).toContain("not independently reviewed");
  });
  it("does not publish an edited trial against a different entry or newly banned claim", () => {
    for (const mode of ["changed-link", "banned-claim"]) {
      const state = flowReducer(withResearch(), confirm);
      const plan = state.workspace.plannedExperiments![0];
      if (mode === "changed-link")
        state.result!.content[0].posts[0].body = invitation.body.replace(
          input.entryUrl,
          "https://other.example/collect"
        );
      else state.memory.bannedClaims = ["scheduled jobs"];
      const next = flowReducer(state, {
        type: "EXPERIMENT_CREATED",
        experiment: {
          id: "blocked-trial",
          plannedExperimentId: plan.id,
          platformId: plan.platformId,
          platformName: plan.platformName,
          community: plan.venue,
          angle: plan.angle,
          variant: invitation.hook,
          hypothesis: "Get useful feedback",
          publishedAt: at,
          status: "live",
          postIdx: 0,
          outcomes: [],
        },
      });
      expect(next).toEqual(state);
      expect(next.workspace.experiments).toEqual([]);
      expect(next.workspace.plannedExperiments![0].status).toBe("ready");
    }
  });
  it("malformed saved research/snapshots never become trusted tasks or clickable links", () => {
    expect(normalizeOpportunityResearch({ input })).toBeUndefined();
    expect(
      normalizeOpportunityResearch({
        ...receipt(seed()),
        sources: [{ ...receipt(seed()).sources[0], url: "javascript:alert(1)" }],
      })?.opportunities
    ).toEqual([]);
    const state = flowReducer(withResearch(), confirm),
      plan = state.workspace.plannedExperiments![0];
    expect(
      normalizePlannedExperiments([
        { ...plan, opportunity: { ...plan.opportunity, entryUrl: "http://localhost" } },
      ])
    ).toEqual([]);
    expect(() => researchUrl("https://example.org/?api_key=secret")).toThrow();
  });
});
