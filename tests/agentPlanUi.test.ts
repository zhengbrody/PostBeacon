// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPlanCard } from "@/components/app/AgentPlanCard";
import { deriveAgentPlan } from "@/lib/agentPlan";
import type { SuccessContract } from "@/lib/types";

let container: HTMLDivElement;
let root: Root;
const plan = deriveAgentPlan({
  url: "https://example.com",
  hasProfile: true,
  facts: [],
  successContract: { primaryGoal: "5 signups" } as SuccessContract,
  strategy: null,
  selectedCount: 0,
  hasResult: false,
  workspace: { experiments: [], taskLog: [] },
  loading: false,
  demo: false,
  now: new Date("2026-11-27T00:00:00Z"),
});
const idle = { active: false, stopped: null, start: vi.fn(), stop: vi.fn() };
const render = (props: Partial<Parameters<typeof AgentPlanCard>[0]>) =>
  act(() =>
    root.render(
      createElement(AgentPlanCard, {
        plan,
        view: "profile",
        loading: false,
        demo: false,
        onRun: vi.fn(),
        onOpen: vi.fn(),
        agentRun: idle,
        ...props,
      })
    )
  );
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent === label);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AgentPlanCard", () => {
  it("offers one step or the run, and states what the run decides for you", () => {
    const start = vi.fn();
    const onRun = vi.fn();
    render({ onRun, agentRun: { ...idle, start } });
    expect(container.textContent).toContain("about 3");
    expect(container.textContent).toContain("without asking you first");
    act(() => button("Rank my channels")!.click());
    expect(onRun).toHaveBeenCalledWith("strategy");
    expect(start).not.toHaveBeenCalled();
    act(() => button("Run through to drafts")!.click());
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("offers no run in the fictional demo", () => {
    render({ demo: true });
    expect(button("Run through to drafts")).toBeUndefined();
  });

  it("replaces the buttons with a stop control while a run is active", () => {
    const stop = vi.fn();
    render({ agentRun: { ...idle, active: true, stop } });
    expect(button("Rank my channels")).toBeUndefined();
    act(() => button("Stop after this step")!.click());
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("says why a run ended", () => {
    render({ agentRun: { ...idle, stopped: "failed" } });
    expect(container.textContent).toContain("a step failed");
  });
});
