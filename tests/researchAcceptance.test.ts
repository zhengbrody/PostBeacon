import { describe, expect, it, vi } from "vitest";
import {
  acceptanceProviders,
  acceptanceRequest,
  preflightAcceptance,
  runResearchAcceptance,
} from "../scripts/research-acceptance";
import {
  normalizeOpportunityResearch,
  researchContextKey,
} from "@/lib/opportunityResearch";
import type { OpportunityResearch } from "@/lib/types";

function output(body?: string): OpportunityResearch {
  const req = acceptanceRequest("openai");
  return normalizeOpportunityResearch({
    id: "acceptance",
    contextKey: researchContextKey(
      req.profile,
      req.facts,
      req.successContract,
      req.productUrl
    ),
    input: req.input,
    sources: [
      {
        id: "s1",
        ...req.input.sources[0],
        verification: "user-provided",
        rules: "unknown",
      },
    ],
    opportunities: [
      {
        sourceId: "s1",
        factIds: ["manual-draft"],
        draft: {
          hook: "Review a draft before publishing.",
          body:
            body ??
            `PostBeacon prepares drafts from verified product facts for manual publishing.\n\nWhich step was unclear?\n\n${req.input.entryUrl}`,
        },
      },
    ],
    meta: { provider: "openai", model: "gpt-4o" },
  })!;
}

describe("bounded research acceptance workload and honest reporting", () => {
  it("is off by default and does not accept truthy strings as spend permission", () => {
    expect(acceptanceProviders({})).toEqual([]);
    expect(acceptanceProviders({ RUN_RESEARCH_ACCEPTANCE: "true" })).toEqual([]);
    expect(acceptanceProviders({ RUN_RESEARCH_ACCEPTANCE: "1" })).toEqual(["openai"]);
  });
  it.each(["claude", "openai,openai", "openai,", "all", ""])(
    "rejects unsafe/duplicate provider plan %s",
    (value) => {
      expect(() =>
        acceptanceProviders({
          RUN_RESEARCH_ACCEPTANCE: "1",
          RESEARCH_ACCEPTANCE_PROVIDERS: value,
        })
      ).toThrow();
    }
  );
  it("requires separate DeepSeek acknowledgement and never silently fans out", () => {
    const env = {
      RUN_RESEARCH_ACCEPTANCE: "1",
      RESEARCH_ACCEPTANCE_PROVIDERS: "openai,deepseek",
    };
    expect(() => acceptanceProviders(env)).toThrow();
    expect(acceptanceProviders({ ...env, RESEARCH_ACCEPTANCE_DEEPSEEK_ACK: "1" })).toEqual([
      "openai",
      "deepseek",
    ]);
  });
  it("preflights the entire key set and refuses unexpected API destinations", () => {
    expect(() =>
      preflightAcceptance(["openai", "deepseek"], { OPENAI_API_KEY: "test" })
    ).toThrow();
    expect(() =>
      preflightAcceptance(["openai"], {
        OPENAI_API_KEY: "test",
        OPENAI_BASE_URL: "https://elsewhere.example",
      })
    ).toThrow();
  });
  it("uses only a clearly controlled scenario with fetching disabled", () => {
    const req = acceptanceRequest("openai");
    expect(req.input.sources[0].quote).toContain("not customer demand");
    expect(req.input.sources.every((s) => !s.fetchAllowed)).toBe(true);
    req.input.steps[0] = "Changed";
    expect(acceptanceRequest("openai").input.steps[0]).not.toBe("Changed");
  });
  it("runs once and verifies ready queue, duplicate rejection and local export/hydration", async () => {
    const run = vi.fn().mockResolvedValue(output());
    const report = await runResearchAcceptance("openai", run);
    expect(run).toHaveBeenCalledOnce();
    expect(report.continuityChecks).toEqual({
      acknowledgements: true,
      singleDraft: true,
      idempotent: true,
      queueHydration: true,
      receiptHydration: true,
      noPublishedExecution: true,
    });
    expect(report).toMatchObject({
      protocol: "passed",
      content: "review-ready",
      localContinuity: "passed",
      productionAccepted: false,
      controlledScenario: true,
    });
    expect(JSON.stringify(report)).not.toContain("https://");
    expect(JSON.stringify(report)).not.toContain("Which step");
  });
  it("does not queue blocked model copy or call again to get a flattering answer", async () => {
    const run = vi
      .fn()
      .mockResolvedValue(output("10k users joined. https://postbeacon.app/app?demo=1"));
    expect(await runResearchAcceptance("openai", run)).toMatchObject({
      protocol: "passed",
      content: "blocked",
      localContinuity: "not-run",
      blockedOpportunities: 1,
    });
    expect(run).toHaveBeenCalledOnce();
  });
  it("reports no fit honestly, rather than inventing an opportunity", async () => {
    const research = output();
    research.opportunities = [];
    expect(
      await runResearchAcceptance("openai", vi.fn().mockResolvedValue(research))
    ).toMatchObject({ protocol: "passed", content: "no-fit", localContinuity: "not-run" });
  });
  it("rejects a different actual provider and never prints upstream errors", async () => {
    expect(
      await runResearchAcceptance("deepseek", vi.fn().mockResolvedValue(output()))
    ).toMatchObject({ protocol: "failed", failure: "provider-provenance" });
    const run = vi.fn().mockRejectedValue(new Error("SECRET private@example.com"));
    const report = await runResearchAcceptance("openai", run);
    expect(JSON.stringify(report)).not.toMatch(/SECRET|private@/);
    expect(report).toMatchObject({ protocol: "failed", failure: "research-failed" });
    expect(run).toHaveBeenCalledOnce();
  });
});
