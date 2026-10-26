// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentMission } from "@/hooks/useAgentMission";
import { deferred, mountHook } from "./helpers/reactHook";
import type { AgentMissionList, AgentMissionResponse } from "@/lib/agentMissions";

const calls = vi.hoisted(() => ({ agentMission: vi.fn(), agentMissionCommand: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: calls }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  calls.agentMission.mockResolvedValue({ enabled: true, mission: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("daily authorization owner and request boundaries", () => {
  it("makes no network requests in a fictional, anonymous or unsaved scope", async () => {
    const hook = await mountHook(
      ({ owner, project, demo }: { owner: string; project: string; demo: boolean }) =>
        useAgentMission(owner, project, demo),
      { owner: "A", project: "P", demo: true }
    );
    try {
      await act(async () => hook.current.command({ action: "pause", projectId: "P" }));
      await hook.render({ owner: "A", project: "", demo: false });
      await hook.render({ owner: "", project: "P", demo: false });
      expect(calls.agentMission).not.toHaveBeenCalled();
      expect(calls.agentMissionCommand).not.toHaveBeenCalled();
    } finally {
      await hook.unmount();
    }
  });
  it("never converts a failed read into paid work or an enabled state", async () => {
    calls.agentMission.mockRejectedValue(new Error("Storage unavailable"));
    const hook = await mountHook(() => useAgentMission("A", "P", false), undefined);
    try {
      expect(hook.current.enabled).toBe(false);
      expect(hook.current.error).toBe("Storage unavailable");
      expect(calls.agentMissionCommand).not.toHaveBeenCalled();
    } finally {
      await hook.unmount();
    }
  });
  it("keeps execution flag closed but permits explicit revocation", async () => {
    calls.agentMission.mockResolvedValue({ enabled: false, mission: null });
    calls.agentMissionCommand.mockResolvedValue({ enabled: false, mission: null });
    const hook = await mountHook(() => useAgentMission("A", "P", false), undefined);
    try {
      await act(async () =>
        hook.current.command({
          action: "run-now",
          projectId: "P",
          contextKey: "context",
          expectedRevision: 1,
        })
      );
      expect(calls.agentMissionCommand).not.toHaveBeenCalled();
      await act(async () => hook.current.command({ action: "pause", projectId: "P" }));
      expect(calls.agentMissionCommand).toHaveBeenCalledExactlyOnceWith(
        { action: "pause", projectId: "P" },
        "A",
        expect.any(AbortSignal)
      );
    } finally {
      await hook.unmount();
    }
  });
  it("hides a late account-A read when account B is current", async () => {
    const gate = deferred<AgentMissionList>();
    calls.agentMission.mockReturnValueOnce(gate.promise);
    const hook = await mountHook<string, ReturnType<typeof useAgentMission>>(
      (owner: string) => useAgentMission(owner, "P", false),
      "A"
    );
    try {
      await hook.render("B");
      await act(async () =>
        gate.resolve({
          enabled: true,
          mission: { id: "private-A" } as AgentMissionList["mission"],
        })
      );
      expect(hook.current.mission).toBeNull();
      expect(calls.agentMission.mock.calls[0][2].aborted).toBe(true);
    } finally {
      await hook.unmount();
    }
  });
  it("discards late commands and suppresses duplicate clicks across account changes", async () => {
    const gate = deferred<AgentMissionResponse>();
    calls.agentMissionCommand.mockReturnValue(gate.promise);
    const hook = await mountHook<string, ReturnType<typeof useAgentMission>>(
      (owner: string) => useAgentMission(owner, "P", false),
      "A"
    );
    let pending: Promise<AgentMissionResponse | undefined> | undefined;
    try {
      await act(async () => {
        pending = hook.current.command({ action: "pause", projectId: "P" });
        void hook.current.command({ action: "pause", projectId: "P" });
      });
      expect(calls.agentMissionCommand).toHaveBeenCalledTimes(1);
      await hook.render("B");
      await act(async () => {
        gate.resolve({
          enabled: true,
          mission: { id: "private-A" } as AgentMissionList["mission"],
        });
        await pending;
      });
      expect(hook.current.mission).toBeNull();
      expect(hook.current.busy).toBe(false);
    } finally {
      await hook.unmount();
    }
  });
  it("does not let an old A→B→A finally unlock a new command", async () => {
    const old = deferred<AgentMissionResponse>();
    const newer = deferred<AgentMissionResponse>();
    calls.agentMissionCommand
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(newer.promise);
    const hook = await mountHook<string, ReturnType<typeof useAgentMission>>(
      (project: string) => useAgentMission("A", project, false),
      "P"
    );
    let first: Promise<AgentMissionResponse | undefined> | undefined;
    let second: Promise<AgentMissionResponse | undefined> | undefined;
    try {
      await act(async () => {
        first = hook.current.command({ action: "pause", projectId: "P" });
      });
      await hook.render("Q");
      await hook.render("P");
      expect(hook.current.busy).toBe(false);
      await act(async () => {
        second = hook.current.command({ action: "pause", projectId: "P" });
      });
      await act(async () => {
        old.resolve({ enabled: true, mission: null });
        await first;
      });
      expect(hook.current.busy).toBe(true);
      await act(async () => {
        void hook.current.command({ action: "pause", projectId: "P" });
      });
      expect(calls.agentMissionCommand).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => {
        newer.resolve({ enabled: true, mission: null });
        await second;
      });
      await hook.unmount();
    }
  });
  it("aborts an overlapping read before a mutation so it cannot rewind the receipt", async () => {
    const gate = deferred<AgentMissionList>();
    calls.agentMissionCommand.mockResolvedValue({ enabled: false, mission: null });
    const hook = await mountHook(() => useAgentMission("A", "P", false), undefined);
    try {
      calls.agentMission.mockReturnValueOnce(gate.promise);
      await act(async () => hook.current.refresh());
      await act(async () => hook.current.command({ action: "pause", projectId: "P" }));
      await act(async () =>
        gate.resolve({
          enabled: true,
          mission: { id: "old-snapshot" } as AgentMissionList["mission"],
        })
      );
      expect(hook.current.mission).toBeNull();
      expect(hook.current.enabled).toBe(false);
    } finally {
      await hook.unmount();
    }
  });
  it("preserves server state and reports errors without claiming success", async () => {
    calls.agentMissionCommand.mockRejectedValue(new Error("Revision changed. Refresh."));
    const hook = await mountHook(() => useAgentMission("A", "P", false), undefined);
    try {
      let response: AgentMissionResponse | undefined;
      await act(async () => {
        response = await hook.current.command({ action: "pause", projectId: "P" });
      });
      expect(response).toBeUndefined();
      expect(hook.current.error).toBe("Revision changed. Refresh.");
      expect(hook.current.mission).toBeNull();
      expect(hook.current.busy).toBe(false);
    } finally {
      await hook.unmount();
    }
  });
});
