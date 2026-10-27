// @vitest-environment jsdom
import { act } from "react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { useBufferPublishing } from "@/hooks/useBufferPublishing";
import { deferred, mountHook } from "./helpers/reactHook";
import type { BufferConnectionResult } from "@/lib/bufferConnections";
const calls = vi.hoisted(() => ({
  bufferConnections: vi.fn(),
  bufferDeliveries: vi.fn(),
  bufferConnectionCommand: vi.fn(),
  bufferDeliveryCommand: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: calls }));
const connection = {
  id: "00000000-0000-4000-8000-000000000001",
  revision: 1,
  status: "connected" as const,
  accountLabel: "Only owner A",
  channels: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  calls.bufferConnections.mockResolvedValue({ enabled: true, connection, setupIssues: [] });
  calls.bufferDeliveries.mockResolvedValue({ enabled: true, deliveries: [] });
});
afterEach(() => vi.unstubAllGlobals());
describe("publishing hook fail-closed ownership and request ordering", () => {
  it("does not read, connect or send in fictional demo", async () => {
    const hook = await mountHook(
      () => useBufferPublishing("owner", "project", true),
      undefined
    );
    try {
      await act(async () => {
        await hook.current.connectionCommand({ action: "connect" });
      });
      expect(calls.bufferConnections).not.toHaveBeenCalled();
      expect(calls.bufferConnectionCommand).not.toHaveBeenCalled();
    } finally {
      await hook.unmount();
    }
  });
  it("keeps disconnect metadata accessible when the delivery table cannot be read, but disables scheduling", async () => {
    calls.bufferDeliveries.mockRejectedValue(new Error("schema unavailable"));
    const hook = await mountHook(() => useBufferPublishing("A", "p", false), undefined);
    try {
      expect(hook.current.enabled).toBe(false);
      expect(hook.current.connection).toEqual(connection);
      expect(hook.current.error).toContain("disconnect");
    } finally {
      await hook.unmount();
    }
  });
  it("focus reads receipts only; it never refreshes a grant or repeats a send", async () => {
    const hook = await mountHook(() => useBufferPublishing("A", "p", false), undefined);
    try {
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
      expect(calls.bufferConnections).toHaveBeenCalledTimes(2);
      expect(calls.bufferDeliveries).toHaveBeenCalledTimes(2);
      expect(calls.bufferConnectionCommand).not.toHaveBeenCalled();
      expect(calls.bufferDeliveryCommand).not.toHaveBeenCalled();
    } finally {
      await hook.unmount();
    }
  });
  it("suppresses double click and discards an old connection command after A→B→A", async () => {
    const old = deferred<BufferConnectionResult>(),
      fresh = deferred<BufferConnectionResult>();
    calls.bufferConnectionCommand
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    const hook = await mountHook<string, ReturnType<typeof useBufferPublishing>>(
      (owner) => useBufferPublishing(owner, "p", false),
      "A"
    );
    let first: Promise<unknown> | undefined, second: Promise<unknown> | undefined;
    try {
      await act(async () => {
        first = hook.current.connectionCommand({ action: "connect" });
        void hook.current.connectionCommand({ action: "connect" });
      });
      expect(calls.bufferConnectionCommand).toHaveBeenCalledTimes(1);
      await hook.render("B");
      await hook.render("A");
      expect(hook.current.busy).toBe(false);
      await act(async () => {
        second = hook.current.connectionCommand({ action: "connect" });
      });
      await act(async () => {
        old.resolve({
          enabled: true,
          connection: { ...connection, accountLabel: "stale" },
          setupIssues: [],
        });
        await first;
      });
      expect(hook.current.busy).toBe(true);
      expect(hook.current.connection?.accountLabel).not.toBe("stale");
      expect(calls.bufferConnectionCommand.mock.calls[0][2].aborted).toBe(true);
    } finally {
      await act(async () => {
        fresh.resolve({ enabled: true, connection, setupIssues: [] });
        await second;
      });
      await hook.unmount();
    }
  });
  it("does not let a pre-command read overwrite a newer connection receipt", async () => {
    const read = deferred<BufferConnectionResult>();
    calls.bufferConnections.mockReturnValueOnce(read.promise);
    calls.bufferConnectionCommand.mockResolvedValue({
      enabled: true,
      connection,
      setupIssues: [],
    });
    const hook = await mountHook(() => useBufferPublishing("A", "p", false), undefined);
    try {
      await act(async () => {
        await hook.current.connectionCommand({ action: "finish" });
      });
      await act(async () => {
        read.resolve({ enabled: true, connection: null, setupIssues: [] });
      });
      expect(hook.current.connection).toEqual(connection);
      expect(calls.bufferConnections.mock.calls[0][1].aborted).toBe(true);
    } finally {
      await hook.unmount();
    }
  });
});
