import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
const mock = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  getSupabase: () => ({ auth: { getSession: mock.session } }),
}));
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  mock.session.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("data-rights requests bind to the initiating account", () => {
  it.each(["connections", "deliveries", "connect", "approve"])(
    "stops Buffer %s before transmission after an account switch",
    async (kind) => {
      mock.session.mockResolvedValue({
        data: { session: { user: { id: "B" }, access_token: "test-B" } },
      });
      const request =
        kind === "connections"
          ? api.bufferConnections("A")
          : kind === "deliveries"
            ? api.bufferDeliveries("project", "A")
            : kind === "connect"
              ? api.bufferConnectionCommand({ action: "connect" }, "A")
              : api.bufferDeliveryCommand(
                  { action: "approve", deliveryId: "id", approvalHash: "0".repeat(64) },
                  "A"
                );
      await expect(request).rejects.toThrow("session changed");
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it("stops a Buffer approval aborted while authentication is resolving", async () => {
    const controller = new AbortController();
    mock.session.mockImplementation(async () => {
      controller.abort();
      return { data: { session: { user: { id: "A" }, access_token: "test-A" } } };
    });
    await expect(
      api.bufferDeliveryCommand(
        { action: "approve", deliveryId: "id", approvalHash: "0".repeat(64) },
        "A",
        controller.signal
      )
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects an empty initiating account instead of using the current session", async () => {
    mock.session.mockResolvedValue({
      data: { session: { user: { id: "A" }, access_token: "test-A" } },
    });
    await expect(api.exportAccount("")).rejects.toThrow("session changed");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["export", "delete"])(
    "blocks %s if authentication resolves to another account",
    async (kind) => {
      mock.session.mockResolvedValue({
        data: { session: { user: { id: "B" }, access_token: "test-B" } },
      });
      const pending = kind === "export" ? api.exportAccount("A") : api.deleteAccount("A");
      await expect(pending).rejects.toThrow("session changed");
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it("aborting while authentication is pending prevents any content request", async () => {
    const controller = new AbortController();
    mock.session.mockImplementation(async () => {
      controller.abort();
      return { data: { session: null } };
    });
    await expect(
      api.analyze("https://example.org", "openai", [], controller.signal)
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("attaches the matching account token and signal, without putting identity in the URL", async () => {
    mock.session.mockResolvedValue({
      data: { session: { user: { id: "A" }, access_token: "test-A" } },
    });
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));
    const controller = new AbortController();
    expect(await api.exportAccount("A", controller.signal)).toBe("{}");
    expect(fetch).toHaveBeenCalledWith("/api/account/export", {
      headers: { Authorization: "Bearer test-A" },
      signal: controller.signal,
    });
  });
});
