import { describe, expect, it } from "vitest";
import { flowReducer, initialFlowState, type FlowState } from "@/hooks/launchFlowReducer";
import { DEMO_PROJECT } from "@/lib/demo";
import { exampleOpportunityResearch, researchContextKey } from "@/lib/opportunityResearch";
import { toJson, toMarkdown } from "@/lib/export";
import { migrateDraft } from "@/lib/storage";
import type { Fact, SuccessContract, TrialResearchInput } from "@/lib/types";

const at = "2026-10-25T00:00:00.000Z";
const contract: SuccessContract = {
  primaryGoal: "Useful feedback",
  primarySignal: "replies",
  minimumResult: 2,
  evaluationWindow: "72h",
};
const fact: Fact = {
  id: "feature",
  field: "features",
  claim: "Acme checks scheduled jobs.",
  sourceType: "user",
  status: "user-confirmed",
  confidence: 1,
  lastVerifiedAt: at,
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
function seed(): FlowState {
  return flowReducer(initialFlowState, {
    type: "PROJECT_LOADED",
    demo: false,
    project: {
      ...DEMO_PROJECT,
      id: "owner-project",
      url: "https://acme.example",
      profile: {
        ...DEMO_PROJECT.profile,
        name: "Acme",
        audience: input.audience,
        publisherVoice: "brand",
        features: [fact.claim],
        conversionGoal: contract.primaryGoal,
      },
      facts: [fact],
      result: {
        content: [{ platformId: "twitter", platformName: "X / Twitter", posts: [] }],
        schedule: [],
      },
      workspace: { experiments: [], taskLog: [], successContract: contract },
    },
  });
}
function reviewed(state = seed()): FlowState {
  const research = exampleOpportunityResearch(
    state.profile!,
    state.facts,
    state.workspace.successContract!,
    state.url,
    state.memory.bannedClaims,
    input
  );
  return flowReducer(state, {
    type: "OPPORTUNITY_RESEARCH_RECEIVED",
    projectId: state.projectId,
    research,
  });
}
const confirm = {
  type: "OPPORTUNITY_QUEUED" as const,
  researchId: "fictional-trial-research",
  opportunityId: "fictional-trial-research:product",
  rulesUserChecked: true,
  trialUserChecked: true,
  at,
};
function publish(state: FlowState): FlowState {
  const plan = state.workspace.plannedExperiments![0];
  return flowReducer(state, {
    type: "EXPERIMENT_CREATED",
    experiment: {
      id: "trial-execution",
      plannedExperimentId: plan.id,
      platformId: plan.platformId,
      platformName: plan.platformName,
      community: plan.venue,
      angle: plan.angle,
      variant: state.result!.content[0].posts[plan.postIdx!].hook,
      hypothesis: "Get useful feedback",
      publishedAt: at,
      status: "live",
      postIdx: plan.postIdx!,
      outcomes: [],
    },
  });
}
function hydrate(state: FlowState): FlowState {
  return flowReducer(initialFlowState, {
    type: "PROJECT_LOADED",
    demo: false,
    project: { ...state, id: state.projectId, ...migrateDraft(JSON.parse(toJson(state))) },
  });
}

describe("CMO Brief → product trial → confirmed queue → publish continuity", () => {
  it("requires both acknowledgements and never publishes merely by receiving or queueing", () => {
    const state = reviewed();
    expect(state.result!.content[0].posts).toEqual([]);
    expect(flowReducer(state, { ...confirm, trialUserChecked: false })).toEqual(state);
    expect(flowReducer(state, { ...confirm, rulesUserChecked: false })).toEqual(state);
    const queued = flowReducer(state, confirm);
    expect(queued.workspace.experiments).toEqual([]);
    expect(queued.workspace.plannedExperiments).toHaveLength(1);
    expect(queued.result!.content[0].posts).toHaveLength(1);
    expect(flowReducer(queued, confirm)).toEqual(queued);
  });
  it("stores verified fact references and context without inventing a demand source", () => {
    const state = flowReducer(reviewed(), confirm);
    const plan = state.workspace.plannedExperiments![0];
    expect(plan.opportunity).toMatchObject({
      mode: "product-led",
      factIds: ["feature"],
      contextKey: researchContextKey(
        state.profile!,
        state.facts,
        contract,
        state.url,
        state.memory.bannedClaims
      ),
    });
    expect(plan.opportunity).not.toHaveProperty("source");
    expect(plan.heldConstant).toContain("No external demand evidence");
    expect(state.workspace.opportunityResearch?.sources).toEqual([]);
    expect(hydrate(state).workspace.plannedExperiments![0].opportunity).toEqual(
      plan.opportunity
    );
    expect(toMarkdown(state)).toContain("product-led; no external demand evidence");
  });
  it("rejects an oversize product context before appending either draft or queue", () => {
    const state = seed();
    state.profile = { ...state.profile!, audience: "a".repeat(51_000) };
    const pending = reviewed(state);
    expect(pending.workspace.opportunityResearch).toBeDefined();
    expect(flowReducer(pending, confirm)).toEqual(pending);
  });
  it("can publish an unchanged hydrated trial and freeze the approved snapshot", () => {
    const queued = hydrate(flowReducer(reviewed(), confirm));
    const state = publish(queued);
    expect(state.workspace.experiments).toHaveLength(1);
    expect(state.workspace.plannedExperiments![0].status).toBe("published");
    expect(state.workspace.experiments[0].opportunity).toEqual(
      queued.workspace.plannedExperiments![0].opportunity
    );
    expect(
      state.workspace.experiments[0].snapshot?.facts.find((f) => f.id === fact.id)?.claim
    ).toBe(fact.claim);
  });
  it("blocks a changed claim even if the fact ID and verification timestamp remain unchanged", () => {
    const queued = flowReducer(reviewed(), confirm);
    const changed = {
      ...queued,
      facts: queued.facts.map((item) =>
        item.id === fact.id ? { ...item, claim: "Acme checks another workflow." } : item
      ),
    };
    expect(publish(changed)).toEqual(changed);
    expect(publish(changed).workspace.plannedExperiments![0].status).toBe("ready");
  });
  it.each(["goal", "url", "banned-claim"])(
    "blocks stale approval when %s changes",
    (kind) => {
      let state = flowReducer(reviewed(), confirm);
      if (kind === "goal")
        state = flowReducer(state, {
          type: "SUCCESS_CONTRACT_SET",
          contract: { ...contract, minimumResult: 9 },
        });
      else if (kind === "url")
        state = flowReducer(state, {
          type: "URL_SET",
          url: "https://acme.example/updated",
        });
      else
        state = flowReducer(state, {
          type: "MEMORY_BANNED_ADDED",
          claim: "different claim",
        });
      expect(publish(state)).toEqual(state);
      expect(state.workspace.experiments).toEqual([]);
    }
  );
  it("retains published trial and fact history after later fact/goal changes and export hydration", () => {
    const published = publish(flowReducer(reviewed(), confirm));
    const before = structuredClone(published.workspace.experiments[0]);
    let changed = flowReducer(published, {
      type: "FACT_CORRECTED",
      id: fact.id,
      claim: "Acme now checks another workflow.",
    });
    changed = flowReducer(changed, {
      type: "SUCCESS_CONTRACT_SET",
      contract: { ...contract, minimumResult: 9 },
    });
    changed = flowReducer(changed, { type: "OPPORTUNITY_RESEARCH_CLEARED" });
    expect(changed.workspace.experiments[0]).toEqual(before);
    expect(hydrate(changed).workspace.experiments[0]).toEqual(before);
    expect(changed.workspace.experiments[0].successContract?.minimumResult).toBe(2);
  });
});
