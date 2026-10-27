import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const seams = vi.hoisted(() => ({
  enabled: true,
  user: vi.fn(),
  prepare: vi.fn(),
  approve: vi.fn(),
  cancel: vi.fn(),
  read: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/lib/usage", () => ({ getUserFromRequest: seams.user }));
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: () => ({}) }));
vi.mock("@/lib/bufferPublishingServer", () => ({
  bufferPublishingEnabled: () => seams.enabled,
  prepareBufferDelivery: seams.prepare,
  approveBufferDelivery: seams.approve,
  cancelBufferDelivery: seams.cancel,
  reconcileBufferDelivery: seams.read,
  listBufferDeliveries: seams.list,
}));
import { GET, POST } from "@/app/api/buffer/deliveries/route";
const id = "00000000-0000-4000-8000-000000000001";
function request(body: unknown, origin = "https://postbeacon.app") {
  return new NextRequest("https://postbeacon.app/api/buffer/deliveries", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  seams.enabled = true;
  seams.user.mockResolvedValue({ id });
  seams.cancel.mockResolvedValue({ id, status: "cancelled" });
  seams.approve.mockResolvedValue({ id, status: "scheduled" });
  seams.list.mockResolvedValue([]);
});
describe("approved scheduling API boundary", () => {
  it("requires authenticated owner and same-origin writes before any delivery command", async () => {
    expect(
      (
        await POST(
          request(
            { action: "approve", deliveryId: id, approvalHash: "a".repeat(64) },
            "https://foreign.example"
          )
        )
      ).status
    ).toBe(403);
    seams.user.mockResolvedValue(null);
    expect(
      (
        await POST(
          request({ action: "approve", deliveryId: id, approvalHash: "a".repeat(64) })
        )
      ).status
    ).toBe(401);
    expect(seams.approve).not.toHaveBeenCalled();
  });
  it("keeps local cancellation available while external publishing is disabled", async () => {
    seams.enabled = false;
    expect(
      (
        await POST(
          request({ action: "approve", deliveryId: id, approvalHash: "a".repeat(64) })
        )
      ).status
    ).toBe(503);
    expect((await POST(request({ action: "cancel-local", deliveryId: id }))).status).toBe(
      200
    );
    expect(seams.cancel).toHaveBeenCalledOnce();
    expect(seams.approve).not.toHaveBeenCalled();
  });
  it("does not accept forged body, destination or provider status in an approval", async () => {
    for (const field of [
      { body: "replacement" },
      { status: "published" },
      { channelId: "other" },
      { scheduledAt: "2099-01-01T00:00:00Z" },
    ])
      expect(
        (
          await POST(
            request({
              action: "approve",
              deliveryId: id,
              approvalHash: "a".repeat(64),
              ...field,
            })
          )
        ).status
      ).toBe(400);
    expect(seams.approve).not.toHaveBeenCalled();
  });
  it("returns no-store receipts and never labels scheduling as publication", async () => {
    const response = await POST(
      request({ action: "approve", deliveryId: id, approvalHash: "a".repeat(64) })
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      enabled: true,
      delivery: { id, status: "scheduled" },
    });
  });
  it("keeps read-reconcile separate from the scheduling mutation", async () => {
    seams.read.mockResolvedValue({ id, status: "published" });
    expect((await POST(request({ action: "read-reconcile", deliveryId: id }))).status).toBe(
      200
    );
    expect(seams.read).toHaveBeenCalledExactlyOnceWith({}, id, id);
    expect(seams.approve).not.toHaveBeenCalled();
  });
  it("bounds body and hides unexpected storage/provider errors", async () => {
    expect((await POST(request({ padding: "x".repeat(13000) }))).status).toBe(413);
    seams.approve.mockRejectedValue(new Error("access-token-private"));
    const response = await POST(
      request({ action: "approve", deliveryId: id, approvalHash: "a".repeat(64) })
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("access-token-private");
  });
  it("lists receipts only for a validated owned project", async () => {
    const result = await GET(
      new NextRequest(`https://postbeacon.app/api/buffer/deliveries?projectId=${id}`)
    );
    expect(result.status).toBe(200);
    expect(seams.list).toHaveBeenCalledExactlyOnceWith({}, id, id);
    expect(
      (
        await GET(
          new NextRequest("https://postbeacon.app/api/buffer/deliveries?projectId=invalid")
        )
      ).status
    ).toBe(400);
  });
});
