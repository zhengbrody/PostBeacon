import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spy on the state change; everything else in the route runs for real.
vi.mock("@/lib/usage", () => ({
  setPlan: vi.fn(async () => {}),
}));
// Keep real verification/evaluation, but control the idempotency ledger.
vi.mock("@/lib/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing")>();
  return { ...actual, recordWebhookEvent: vi.fn(async () => "new" as const) };
});

import { POST } from "@/app/api/billing/webhook/route";
import { setPlan } from "@/lib/usage";
import { recordWebhookEvent } from "@/lib/billing";

const SECRET = "test-webhook-secret";
const UID = "123e4567-e89b-12d3-a456-426614174000";
const PRODUCT = "prod_123";

function signedRequest(
  body: string,
  { id = "msg_1", tsOffsetS = 0, badSig = false } = {}
): NextRequest {
  const ts = Math.floor(Date.now() / 1000) + tsOffsetS;
  const sig = crypto
    .createHmac("sha256", Buffer.from(SECRET, "utf8"))
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  return new NextRequest("http://localhost/api/billing/webhook", {
    method: "POST",
    body,
    headers: {
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${badSig ? sig.replace(/^./, "x") : sig}`,
    },
  });
}

const paidOrder = JSON.stringify({
  type: "order.paid",
  data: { product_id: PRODUCT, metadata: { user_id: UID } },
});

describe("POST /api/billing/webhook", () => {
  beforeEach(() => {
    vi.stubEnv("POLAR_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("POLAR_PRODUCT_ID", PRODUCT);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("fails closed (503) when POLAR_WEBHOOK_SECRET is missing", async () => {
    vi.stubEnv("POLAR_WEBHOOK_SECRET", "");
    const res = await POST(signedRequest(paidOrder));
    expect(res.status).toBe(503);
    expect(setPlan).not.toHaveBeenCalled();
  });

  it("rejects a bad signature with 401 and changes nothing", async () => {
    const res = await POST(signedRequest(paidOrder, { badSig: true }));
    expect(res.status).toBe(401);
    expect(setPlan).not.toHaveBeenCalled();
  });

  it("rejects a stale (replayed-later) timestamp with 401", async () => {
    const res = await POST(signedRequest(paidOrder, { tsOffsetS: -3600 }));
    expect(res.status).toBe(401);
    expect(setPlan).not.toHaveBeenCalled();
  });

  it("rejects unsigned requests outright", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/billing/webhook", {
        method: "POST",
        body: paidOrder,
      })
    );
    expect(res.status).toBe(401);
  });

  it("rejects oversized bodies with 413", async () => {
    const res = await POST(signedRequest("x".repeat(300_000)));
    expect(res.status).toBe(413);
  });

  it("processes a valid, fresh, first-time event", async () => {
    const res = await POST(signedRequest(paidOrder));
    expect(res.status).toBe(200);
    expect(setPlan).toHaveBeenCalledExactlyOnceWith(UID, "pro");
  });

  it("acks a replayed webhook-id without reprocessing", async () => {
    vi.mocked(recordWebhookEvent).mockResolvedValueOnce("duplicate");
    const res = await POST(signedRequest(paidOrder));
    expect(res.status).toBe(200);
    expect(setPlan).not.toHaveBeenCalled();
  });

  it("ignores valid events for a different product", async () => {
    const other = JSON.stringify({
      type: "order.paid",
      data: { product_id: "prod_other", metadata: { user_id: UID } },
    });
    const res = await POST(signedRequest(other));
    expect(res.status).toBe(200); // acked so Polar stops retrying
    expect(setPlan).not.toHaveBeenCalled();
  });

  it("ignores valid events of unhandled types", async () => {
    const benefit = JSON.stringify({
      type: "benefit.granted",
      data: { product_id: PRODUCT, metadata: { user_id: UID } },
    });
    const res = await POST(signedRequest(benefit));
    expect(res.status).toBe(200);
    expect(setPlan).not.toHaveBeenCalled();
  });
});
