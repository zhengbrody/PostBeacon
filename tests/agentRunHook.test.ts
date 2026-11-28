// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAgentRun } from "@/hooks/useAgentRun";
import { deriveAgentPlan, type AgentAction, type AgentPlanInput } from "@/lib/agentPlan";
import type { MarketingStrategy, SuccessContract } from "@/lib/types";

/** A stand-in for the launch flow: each step takes one tick, then changes state. */
type Sim = { strategy: boolean; result: boolean; loading: boolean; error: boolean };
let api: {
  run: ReturnType<typeof useAgentRun>;
  sim: Sim;
  finish: (patch: Partial<Sim>) => void;
};
let calls: AgentAction[];
let container: HTMLDivElement;
let root: Root;

const input = (sim: Sim): AgentPlanInput => ({
  url: "https://example.com",
  hasProfile: true,
  facts: [],
  successContract: { primaryGoal: "5 signups" } as SuccessContract,
  strategy: sim.strategy
    ? ({ recommendations: [{}] } as unknown as MarketingStrategy)
    : null,
  selectedCount: sim.strategy ? 1 : 0,
  hasResult: sim.result,
  workspace: { experiments: [], taskLog: [] },
  loading: sim.loading,
  demo: false,
  now: new Date("2026-11-27T00:00:00Z"),
});

function Harness() {
  const [sim, setSim] = useState<Sim>({
    strategy: false,
    result: false,
    loading: false,
    error: false,
  });
  const run = useAgentRun({
    plan: deriveAgentPlan(input(sim)),
    loading: sim.loading,
    failed: sim.error,
    run: (action) => {
      calls.push(action);
      setSim((current) => ({ ...current, loading: true, error: false }));
    },
  });
  api = {
    run,
    sim,
    finish: (patch) => setSim((c) => ({ ...c, loading: false, ...patch })),
  };
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useAgentRun", () => {
  it("does nothing until started", () => {
    expect(calls).toEqual([]);
    expect(api.run.active).toBe(false);
  });

  it("runs both agent steps once each and ends at the founder's step", () => {
    act(() => api.run.start());
    expect(calls).toEqual(["strategy"]);
    act(() => api.finish({ strategy: true }));
    expect(calls).toEqual(["strategy", "generate"]);
    act(() => api.finish({ result: true }));
    expect(calls).toEqual(["strategy", "generate"]);
    expect(api.run.active).toBe(false);
    expect(api.run.stopped).toBe("needs-you");
  });

  it("stops after a failed step without running the next one", () => {
    act(() => api.run.start());
    act(() => api.finish({ error: true }));
    expect(calls).toEqual(["strategy"]);
    expect(api.run.stopped).toBe("failed");
  });

  it("does not continue after the founder stops it mid-step", () => {
    act(() => api.run.start());
    act(() => api.run.stop());
    act(() => api.finish({ strategy: true }));
    expect(calls).toEqual(["strategy"]);
    expect(api.run.stopped).toBe("by-you");
  });

  it("stops rather than repeating a step that produced nothing", () => {
    act(() => api.run.start());
    act(() => api.finish({}));
    expect(calls).toEqual(["strategy"]);
    expect(api.run.stopped).toBe("incomplete");
  });
});
