import { describe, expect, it } from "vitest";
import { deriveAgentPlan, type AgentPlanInput } from "@/lib/agentPlan";
import type { Experiment, Fact, MarketingStrategy, SuccessContract } from "@/lib/types";

const now = new Date("2026-11-26T12:00:00Z");
const fact = (id: string, status: Fact["status"]): Fact => ({
  id,
  claim: `claim ${id}`,
  sourceType: "page",
  status,
  confidence: 0.8,
  lastVerifiedAt: now.toISOString(),
});
const contract: SuccessContract = {
  primaryGoal: "Get 5 signups",
  primarySignal: "signups",
  minimumResult: 5,
  evaluationWindow: "72h",
} as SuccessContract;
const strategy = { recommendations: [{}, {}, {}] } as unknown as MarketingStrategy;
const experiment = (hoursAgo: number, checkpoints: string[] = []): Experiment =>
  ({
    id: "e1",
    status: "live",
    publishedAt: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
    outcomes: checkpoints.map((checkpoint) => ({ id: checkpoint, checkpoint })),
  }) as unknown as Experiment;

const base: AgentPlanInput = {
  url: "",
  hasProfile: false,
  facts: [],
  strategy: null,
  selectedCount: 0,
  hasResult: false,
  workspace: { experiments: [], taskLog: [] },
  loading: false,
  demo: false,
  now,
};
const plan = (patch: Partial<AgentPlanInput>) => deriveAgentPlan({ ...base, ...patch });
const step = (patch: Partial<AgentPlanInput>, id: string) =>
  plan(patch).steps.find((item) => item.id === id)!;
const analyzed = {
  url: "https://example.com",
  hasProfile: true,
  facts: [fact("a", "observed"), fact("b", "user-confirmed"), fact("c", "inferred")],
};

describe("deriveAgentPlan", () => {
  it("starts by asking for the URL and offers no agent action", () => {
    const result = plan({});
    expect(result.current?.id).toBe("read");
    expect(result.current?.status).toBe("needs-you");
    expect(result.steps.every((item) => !item.action)).toBe(true);
    expect(result.remainingModelRequests).toBe(4);
  });

  it("counts verified facts from state and stops for the founder's goal", () => {
    const result = plan(analyzed);
    expect(result.steps[0].detail).toContain(
      "3 facts on record: 2 verified, 1 not verified"
    );
    expect(result.current?.id).toBe("confirm");
    expect(result.current?.owner).toBe("you");
    // Without a goal the agent may not rank channels.
    expect(step(analyzed, "channel").action).toBeUndefined();
    expect(step(analyzed, "channel").status).toBe("waiting");
  });

  it("offers channel ranking only after the goal is set", () => {
    const result = plan({ ...analyzed, successContract: contract });
    expect(result.current?.id).toBe("channel");
    expect(result.current?.action).toBe("strategy");
    expect(result.current?.modelRequests).toBe(2);
  });

  it("writes drafts only on an explicit approval of a selected channel", () => {
    const ranked = { ...analyzed, successContract: contract, strategy };
    expect(step(ranked, "drafts").status).toBe("needs-you");
    expect(step(ranked, "drafts").action).toBeUndefined();
    const selected = step({ ...ranked, selectedCount: 2 }, "drafts");
    expect(selected.action).toBe("generate");
    expect(selected.actionLabel).toContain("Approve");
    expect(selected.modelRequests).toBe(2);
  });

  it("never gives the agent an action for posting or measuring", () => {
    const ready = {
      ...analyzed,
      successContract: contract,
      strategy,
      selectedCount: 1,
      hasResult: true,
    };
    const result = plan(ready);
    expect(result.current?.id).toBe("publish");
    expect(result.current?.owner).toBe("you");
    expect(result.steps.every((item) => !item.action)).toBe(true);
    expect(result.remainingModelRequests).toBe(0);
  });

  it("waits until a check is due, then asks for the numbers", () => {
    const ready = {
      ...analyzed,
      successContract: contract,
      strategy,
      selectedCount: 1,
      hasResult: true,
    };
    const fresh = { experiments: [experiment(2)], taskLog: [] };
    expect(step({ ...ready, workspace: fresh }, "measure").status).toBe("waiting");
    const due = { experiments: [experiment(30)], taskLog: [] };
    expect(step({ ...ready, workspace: due }, "measure").status).toBe("needs-you");
    const recorded = { experiments: [experiment(30, ["24h"])], taskLog: [] };
    expect(step({ ...ready, workspace: recorded }, "measure").status).toBe("done");
    const second = { experiments: [experiment(80, ["24h"])], taskLog: [] };
    expect(step({ ...ready, workspace: second }, "measure").status).toBe("needs-you");
  });

  it("shows running instead of an action while a request is in flight", () => {
    const busy = step({ ...analyzed, successContract: contract, loading: true }, "channel");
    expect(busy.status).toBe("running");
    expect(busy.action).toBeUndefined();
  });

  it("spends nothing in the fictional demo", () => {
    const result = plan({ ...analyzed, successContract: contract, demo: true });
    expect(result.remainingModelRequests).toBe(0);
  });

  it("keeps the weekly task beside the path, never as the current step", () => {
    const ready = { ...analyzed, successContract: contract };
    expect(step(ready, "improve").status).toBe("ready");
    expect(plan(ready).current?.id).not.toBe("improve");
    expect(step(analyzed, "improve").status).toBe("waiting");
  });
});
