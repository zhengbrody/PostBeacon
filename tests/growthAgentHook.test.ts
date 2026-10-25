// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGrowthAgent } from "@/hooks/useGrowthAgent";
import { deferred, mountHook } from "./helpers/reactHook";
import type { AgentRunList } from "@/lib/agentRuns";
import type { TrialResearchInput } from "@/lib/types";
const input: TrialResearchInput = {
  audience: "Developers",
  task: "Try one demo",
  entryUrl: "https://example.org/demo",
  platformId: "twitter",
  venue: "Own X profile",
  steps: ["Open", "Try", "Reply"],
  feedbackQuestion: "What was unclear?",
  sources: [],
};
const calls = vi.hoisted(() => ({ agentRuns: vi.fn(), agentCommand: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: calls }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  calls.agentRuns.mockResolvedValue({ enabled: true, runs: [] });
});
afterEach(() => vi.unstubAllGlobals());
describe("Agent hook owner/project boundary", () => {
  it("does not let an aborted A→B→A command unlock a newer command", async () => {
    const oldGate = deferred<AgentRunList["runs"][number]>();
    const newGate = deferred<AgentRunList["runs"][number]>();
    calls.agentCommand
      .mockReturnValueOnce(oldGate.promise)
      .mockReturnValueOnce(newGate.promise);
    const hook = await mountHook<string, ReturnType<typeof useGrowthAgent>>(
      (project) => useGrowthAgent("owner", project, false),
      "A"
    );
    let oldCommand: Promise<void> | undefined;
    let newCommand: Promise<void> | undefined;
    try {
      await act(async () => {
        oldCommand = hook.current.start(input, "openai", "context", false);
      });
      await hook.render("B");
      await hook.render("A");
      await act(async () => {
        newCommand = hook.current.start(input, "openai", "context", false);
      });
      expect(hook.current.busy).toBe(true);
      expect(calls.agentCommand).toHaveBeenCalledTimes(2);
      expect(calls.agentCommand.mock.calls[0][2].aborted).toBe(true);

      await act(async () => {
        oldGate.resolve({ id: "stale-A", projectId: "A" } as AgentRunList["runs"][number]);
        await oldCommand;
      });
      expect(hook.current.runs).toEqual([]);
      expect(hook.current.busy).toBe(true);
      await act(async () => {
        void hook.current.start(input, "openai", "context", false);
      });
      expect(calls.agentCommand).toHaveBeenCalledTimes(2);
      expect(calls.agentCommand.mock.calls[1][2].aborted).toBe(false);
    } finally {
      await act(async () => {
        newGate.resolve({
          id: "current-A",
          projectId: "A",
        } as AgentRunList["runs"][number]);
        await newCommand;
      });
      await hook.unmount();
    }
  });
  it("suppresses double clicks and discards a late command across accounts", async () => {
    const gate = deferred<AgentRunList["runs"][number]>();
    calls.agentCommand.mockReturnValue(gate.promise);
    const hook = await mountHook<string, ReturnType<typeof useGrowthAgent>>(
      (owner) => useGrowthAgent(owner, "project", false),
      "A"
    );
    let first: Promise<void> | undefined;
    try {
      await act(async () => {
        first = hook.current.start(input, "openai", "context", false);
        void hook.current.start(input, "openai", "context", false);
      });
      expect(calls.agentCommand).toHaveBeenCalledTimes(1);
      await hook.render("B");
      await act(async () => {
        gate.resolve({
          id: "private-A",
          projectId: "project",
        } as AgentRunList["runs"][number]);
        await first;
      });
      expect(hook.current.runs).toEqual([]);
      expect(calls.agentCommand.mock.calls[0][2].aborted).toBe(true);
    } finally {
      await hook.unmount();
    }
  });
  it("reuses an idempotency key after an ambiguous network failure", async () => {
    calls.agentCommand.mockRejectedValue(new Error("Network unavailable"));
    const hook = await mountHook(() => useGrowthAgent("A", "project", false), undefined);
    try {
      await act(async () => {
        await hook.current.start(input, "openai", "context", false);
      });
      await act(async () => {
        await hook.current.start(input, "openai", "context", false);
      });
      expect(calls.agentCommand).toHaveBeenCalledTimes(2);
      expect(calls.agentCommand.mock.calls[0][0].requestId).toBe(
        calls.agentCommand.mock.calls[1][0].requestId
      );
    } finally {
      await hook.unmount();
    }
  });
  it("ignores another account's late task list", async () => {
    const gate = deferred<AgentRunList>();
    calls.agentRuns.mockReturnValueOnce(gate.promise);
    const hook = await mountHook<string, ReturnType<typeof useGrowthAgent>>(
      (owner: string) => useGrowthAgent(owner, "project", false),
      "A"
    );
    try {
      await hook.render("B");
      await act(async () =>
        gate.resolve({ enabled: true, runs: [{ id: "private-A" }] as AgentRunList["runs"] })
      );
      expect(hook.current.runs).toEqual([]);
      expect(calls.agentRuns.mock.calls[0][2].aborted).toBe(true);
    } finally {
      await hook.unmount();
    }
  });
  it("does not call authenticated storage for fictional or unsaved projects", async () => {
    const hook = await mountHook<boolean, ReturnType<typeof useGrowthAgent>>(
      (demo: boolean) => useGrowthAgent("A", "", demo),
      true
    );
    try {
      expect(calls.agentRuns).not.toHaveBeenCalled();
      await hook.render(false);
      expect(calls.agentRuns).not.toHaveBeenCalled();
    } finally {
      await hook.unmount();
    }
  });
  it("never turns a read failure into a retrying model request", async () => {
    calls.agentRuns.mockRejectedValue(new Error("Storage unavailable"));
    const hook = await mountHook(() => useGrowthAgent("A", "project", false), undefined);
    try {
      expect(hook.current.error).toBe("Storage unavailable");
      expect(calls.agentRuns).toHaveBeenCalledTimes(1);
      expect(calls.agentCommand).not.toHaveBeenCalled();
    } finally {
      await hook.unmount();
    }
  });
});
