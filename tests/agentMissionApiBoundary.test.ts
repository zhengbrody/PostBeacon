import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
const mock = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  getSupabase: () => ({ auth: { getSession: mock.session } }),
}));
beforeEach(() => {
  mock.session.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("mission API account-bound authentication", () => {
  it.each(["read", "command"])(
    "never sends a %s under another account's resolved session",
    async (mode) => {
      mock.session.mockResolvedValue({
        data: { session: { user: { id: "B" }, access_token: "test-B" } },
      });
      const request =
        mode === "read"
          ? api.agentMission("P", "A")
          : api.agentMissionCommand({ action: "pause", projectId: "P" }, "A");
      await expect(request).rejects.toThrow("session changed");
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it("keeps read responses uncached and sends only the matching initiating bearer", async () => {
    mock.session.mockResolvedValue({
      data: { session: { user: { id: "A" }, access_token: "test-A" } },
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ enabled: false, mission: null }))
    );
    const controller = new AbortController();
    await api.agentMission("P", "A", controller.signal);
    expect(fetch).toHaveBeenCalledWith("/api/agent-missions?projectId=P", {
      headers: { Authorization: "Bearer test-A" },
      cache: "no-store",
      signal: controller.signal,
    });
  });
  it("aborts a command before transmission when auth resolution is interrupted", async () => {
    const controller = new AbortController();
    mock.session.mockImplementation(async () => {
      controller.abort();
      return { data: { session: { user: { id: "A" }, access_token: "test-A" } } };
    });
    await expect(
      api.agentMissionCommand({ action: "pause", projectId: "P" }, "A", controller.signal)
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
