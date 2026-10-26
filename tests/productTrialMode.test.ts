import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_PROJECT } from "@/lib/demo";
import {
  exampleOpportunityResearch,
  normalizeOpportunityResearch,
  normalizeResearchInput,
  normalizeTrialSnapshot,
  trialSafety,
} from "@/lib/opportunityResearch";
import { runOpportunityResearch } from "@/lib/opportunityResearchServer";
import type { Fact, SuccessContract, TrialResearchInput } from "@/lib/types";

const calls = vi.hoisted(() => ({ model: vi.fn(), scrape: vi.fn() }));
vi.mock("@/lib/llm", () => ({ generateJsonOnce: calls.model }));
vi.mock("@/lib/scrape", () => ({ scrapeStaticSource: calls.scrape }));
const facts: Fact[] = [
  {
    id: "feature",
    field: "features",
    claim: "Acme checks scheduled jobs.",
    sourceType: "user",
    status: "user-confirmed",
    confidence: 1,
    lastVerifiedAt: "2026-10-25T00:00:00.000Z",
  },
];
const profile = {
  ...DEMO_PROJECT.profile,
  name: "Acme",
  features: [facts[0].claim],
  publisherVoice: "brand" as const,
};
const contract: SuccessContract = {
  primaryGoal: "Useful feedback",
  primarySignal: "replies",
  minimumResult: 2,
  evaluationWindow: "72h",
};
const input: TrialResearchInput = {
  mode: "product-led",
  audience: "Independent developers",
  task: "Try one scheduled job check",
  entryUrl: "https://acme.example/demo",
  platformId: "twitter",
  venue: "Own X profile",
  steps: ["Open the demo", "Inspect one sample job", "Share one confusing step"],
  feedbackQuestion: "Which step was unclear?",
  sources: [],
};
const candidate = {
  whyFit: "Product-fact hypothesis only; no external demand evidence.",
  factIds: ["feature"],
  hook: "Try one scheduled job check.",
  body: "Acme checks scheduled jobs.\n\nWhich step was unclear?\n\nhttps://acme.example/demo",
};
const request = () => ({
  provider: "openai" as const,
  productUrl: "https://acme.example",
  profile,
  facts,
  successContract: contract,
  input: structuredClone(input),
});
const source = {
  url: "https://example.org/need",
  quote: "How can a developer tell whether a scheduled job actually ran?",
  fetchAllowed: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  calls.model.mockResolvedValue({
    data: { opportunities: [candidate] },
    meta: { provider: "openai", model: "test-model" },
  });
});

describe("explicit product-led trial mode", () => {
  it("preserves legacy input shape and refuses a source-less legacy/evidence request", () => {
    const { mode: _mode, ...legacy } = input;
    expect(normalizeResearchInput({ ...legacy, sources: [source] })).toEqual({
      ...legacy,
      sources: [source],
    });
    expect(normalizeResearchInput(legacy)).toBeUndefined();
    expect(normalizeResearchInput({ ...input, mode: "evidence-led" })).toBeUndefined();
    expect(normalizeResearchInput({ ...input, mode: "unknown" })).toBeUndefined();
    expect(normalizeResearchInput({ ...input, sources: [source] })).toBeUndefined();
  });
  it("uses one model request and zero source fetches with an empty source progress receipt", async () => {
    const progress = {
      sources: vi.fn().mockResolvedValue(undefined),
      beforeModel: vi.fn().mockResolvedValue(undefined),
    };
    const result = await runOpportunityResearch(request(), progress);
    expect(calls.scrape).not.toHaveBeenCalled();
    expect(calls.model).toHaveBeenCalledOnce();
    expect(progress.sources).toHaveBeenCalledExactlyOnceWith([]);
    expect(progress.beforeModel).toHaveBeenCalledOnce();
    expect(result.sources).toEqual([]);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].id).toBe(`${result.id}:product`);
    expect(result.opportunities[0]).not.toHaveProperty("sourceId");
    expect(trialSafety(result, result.opportunities[0].id, facts, profile)).toEqual([]);
    const wire = JSON.parse(calls.model.mock.calls[0][0].user);
    expect(wire.sources).toEqual([]);
    expect(wire.trial.mode).toBe("product-led");
    expect(calls.model.mock.calls[0][0].system).toContain("NO external demand sources");
  });
  it("never treats failed evidence research as a product-led invitation", async () => {
    calls.scrape.mockResolvedValue({ text: "Different text", textTruncated: false });
    const result = await runOpportunityResearch({
      ...request(),
      input: {
        ...input,
        mode: "evidence-led",
        sources: [{ ...source, fetchAllowed: true }],
      },
    });
    expect(result.input.mode).toBe("evidence-led");
    expect(result.opportunities).toEqual([]);
    expect(calls.model).not.toHaveBeenCalled();
  });
  it("requires confirmed product facts before any provider request", async () => {
    await expect(
      runOpportunityResearch({ ...request(), facts: [{ ...facts[0], status: "inferred" }] })
    ).rejects.toMatchObject({ status: 400 });
    expect(calls.model).not.toHaveBeenCalled();
    expect(calls.scrape).not.toHaveBeenCalled();
  });
  it.each([
    { ...candidate, sourceId: "invented-demand" },
    { ...candidate, factIds: ["invented-fact"] },
  ])("rejects invented evidence or fact citations", async (bad) => {
    calls.model.mockResolvedValue({
      data: { opportunities: [bad] },
      meta: { provider: "openai", model: "test-model" },
    });
    expect((await runOpportunityResearch(request())).opportunities).toEqual([]);
  });
  it("returns at most one invitation and does not retry an empty result", async () => {
    calls.model.mockResolvedValueOnce({
      data: { opportunities: [candidate, candidate] },
      meta: { provider: "openai", model: "test-model" },
    });
    expect((await runOpportunityResearch(request())).opportunities).toHaveLength(1);
    calls.model.mockResolvedValueOnce({
      data: { opportunities: [] },
      meta: { provider: "openai", model: "test-model" },
    });
    expect((await runOpportunityResearch(request())).opportunities).toEqual([]);
    expect(calls.model).toHaveBeenCalledTimes(2);
  });
  it("does not retry or fetch after a provider failure", async () => {
    calls.model.mockRejectedValue(new Error("provider unavailable"));
    await expect(runOpportunityResearch(request())).rejects.toThrow("provider unavailable");
    expect(calls.model).toHaveBeenCalledOnce();
    expect(calls.scrape).not.toHaveBeenCalled();
  });
  it("normalizes a fact-only snapshot without inventing a source and preserves legacy source requirements", () => {
    const snapshot = {
      researchId: "research",
      contextKey: "current-context-version",
      mode: "product-led",
      factIds: ["feature"],
      audience: input.audience,
      task: input.task,
      entryUrl: input.entryUrl,
      steps: input.steps,
      feedbackQuestion: input.feedbackQuestion,
      rulesUserCheckedAt: "2026-10-25T00:00:00.000Z",
    };
    expect(normalizeTrialSnapshot(snapshot)).toEqual(snapshot);
    expect(normalizeTrialSnapshot({ ...snapshot, factIds: [] })).toBeUndefined();
    expect(normalizeTrialSnapshot({ ...snapshot, contextKey: undefined })).toBeUndefined();
    expect(normalizeTrialSnapshot({ ...snapshot, contextKey: " " })).toBeUndefined();
    expect(
      normalizeTrialSnapshot({ ...snapshot, contextKey: "a".repeat(50_001) })
    ).toBeUndefined();
    expect(normalizeTrialSnapshot({ ...snapshot, source })).toBeUndefined();
    expect(normalizeTrialSnapshot({ ...snapshot, mode: undefined })).toBeUndefined();
    expect(normalizeTrialSnapshot({ ...snapshot, mode: "unknown" })).toBeUndefined();
    const legacy = {
      ...snapshot,
      mode: undefined,
      contextKey: undefined,
      factIds: undefined,
      source: {
        id: "s1",
        ...source,
        verification: "user-provided",
        checkedAt: "2026-10-25T00:00:00.000Z",
        rules: "unknown",
      },
    };
    expect(normalizeTrialSnapshot(legacy)?.source?.id).toBe("s1");
  });
  it("uses the current Brief for fictional demo without any source or provider call", () => {
    const result = exampleOpportunityResearch(
      profile,
      facts,
      contract,
      request().productUrl,
      [],
      input
    );
    expect(result.example).toBe(true);
    expect(result.input).toEqual(input);
    expect(result.sources).toEqual([]);
    expect(result.opportunities[0].id).toBe(`${result.id}:product`);
    expect(result.opportunities[0].draft.hook).toBe(input.task);
    expect(calls.model).not.toHaveBeenCalled();
    expect(calls.scrape).not.toHaveBeenCalled();
    expect(normalizeOpportunityResearch(result)).toEqual(result);
    expect(trialSafety(result, result.opportunities[0].id, facts, profile)).toEqual([]);
    expect(
      trialSafety(
        result,
        result.opportunities[0].id,
        [{ ...facts[0], status: "inferred" }],
        profile
      )
    ).toContain("The invitation needs a current verified or user-confirmed product fact.");
  });
});
