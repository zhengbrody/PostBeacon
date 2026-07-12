import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolvePlanChange, verifyWebhook, WEBHOOK_TOLERANCE_S } from "@/lib/billing";

const RAW_SECRET = "test-secret-value";
const B64_SECRET = "whsec_" + Buffer.from("another-secret").toString("base64");
const UID = "123e4567-e89b-12d3-a456-426614174000";
const PRODUCT = "prod_123";

function sign(id: string, ts: number, payload: string, secret: string): string {
  const key = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice(6), "base64")
    : Buffer.from(secret, "utf8");
  return crypto.createHmac("sha256", key).update(`${id}.${ts}.${payload}`).digest("base64");
}

function headersFor(payload: string, secret: string, tsOffsetS = 0) {
  const id = "msg_1";
  const ts = Math.floor(Date.now() / 1000) + tsOffsetS;
  return {
    id,
    timestamp: String(ts),
    signature: `v1,${sign(id, ts, payload, secret)}`,
  };
}

describe("verifyWebhook", () => {
  const payload = JSON.stringify({ type: "order.paid" });

  it("accepts a fresh, correctly signed payload (raw secret)", () => {
    const v = verifyWebhook(headersFor(payload, RAW_SECRET), payload, RAW_SECRET);
    expect(v).toEqual({ ok: true, id: "msg_1" });
  });

  it("accepts the whsec_ base64 secret form", () => {
    const v = verifyWebhook(headersFor(payload, B64_SECRET), payload, B64_SECRET);
    expect(v.ok).toBe(true);
  });

  it("accepts when any of several space-separated signatures matches", () => {
    const h = headersFor(payload, RAW_SECRET);
    h.signature = `v1,${Buffer.from("wrong").toString("base64")} ${h.signature}`;
    expect(verifyWebhook(h, payload, RAW_SECRET).ok).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const h = headersFor(payload, RAW_SECRET);
    const v = verifyWebhook(h, payload + "x", RAW_SECRET);
    expect(v).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects the wrong secret", () => {
    const h = headersFor(payload, RAW_SECRET);
    expect(verifyWebhook(h, payload, "other-secret").ok).toBe(false);
  });

  it("rejects missing headers", () => {
    const v = verifyWebhook(
      { id: null, timestamp: null, signature: null },
      payload,
      RAW_SECRET
    );
    expect(v).toEqual({ ok: false, reason: "missing-headers" });
  });

  it("rejects stale and future timestamps (replay window)", () => {
    const past = headersFor(payload, RAW_SECRET, -(WEBHOOK_TOLERANCE_S + 60));
    expect(verifyWebhook(past, payload, RAW_SECRET)).toEqual({
      ok: false,
      reason: "stale-timestamp",
    });
    const future = headersFor(payload, RAW_SECRET, WEBHOOK_TOLERANCE_S + 60);
    expect(verifyWebhook(future, payload, RAW_SECRET).ok).toBe(false);
  });

  it("rejects a non-numeric timestamp even when signed", () => {
    const id = "msg_1";
    const ts = "soon" as unknown as number;
    const signature = `v1,${sign(id, ts, payload, RAW_SECRET)}`;
    const v = verifyWebhook({ id, timestamp: String(ts), signature }, payload, RAW_SECRET);
    expect(v.ok).toBe(false);
  });
});

describe("resolvePlanChange", () => {
  const order = (over: Record<string, unknown> = {}) => ({
    type: "order.paid",
    data: { product_id: PRODUCT, metadata: { user_id: UID }, ...over },
  });

  it("flips to pro on a paid order for the configured product", () => {
    expect(resolvePlanChange(order(), PRODUCT)).toEqual({ userId: UID, plan: "pro" });
  });

  it("maps subscription lifecycle to pro/free", () => {
    const sub = (type: string, status: string) => ({
      type,
      data: { product_id: PRODUCT, status, metadata: { user_id: UID } },
    });
    expect(resolvePlanChange(sub("subscription.active", "active"), PRODUCT)).toEqual({
      userId: UID,
      plan: "pro",
    });
    expect(resolvePlanChange(sub("subscription.updated", "active"), PRODUCT)).toEqual({
      userId: UID,
      plan: "pro",
    });
    expect(resolvePlanChange(sub("subscription.canceled", "canceled"), PRODUCT)).toEqual({
      userId: UID,
      plan: "free",
    });
    expect(resolvePlanChange(sub("subscription.updated", "past_due"), PRODUCT)).toEqual({
      userId: UID,
      plan: "free",
    });
  });

  it("ignores events for a different product", () => {
    expect(resolvePlanChange(order({ product_id: "prod_other" }), PRODUCT)).toBeNull();
  });

  it("ignores events with no product id at all (fail closed)", () => {
    expect(resolvePlanChange(order({ product_id: undefined }), PRODUCT)).toBeNull();
  });

  it("ignores everything when POLAR_PRODUCT_ID isn't configured (fail closed)", () => {
    expect(resolvePlanChange(order(), undefined)).toBeNull();
  });

  it("ignores unknown event types", () => {
    expect(
      resolvePlanChange({ type: "checkout.created", data: order().data }, PRODUCT)
    ).toBeNull();
    expect(resolvePlanChange({ type: "benefit.granted" }, PRODUCT)).toBeNull();
  });

  it("rejects user ids that aren't UUIDs", () => {
    expect(
      resolvePlanChange(order({ metadata: { user_id: "'; drop table--" } }), PRODUCT)
    ).toBeNull();
    expect(resolvePlanChange(order({ metadata: {} }), PRODUCT)).toBeNull();
  });

  it("finds the product id on nested payload shapes", () => {
    expect(
      resolvePlanChange(
        {
          type: "order.paid",
          data: { product: { id: PRODUCT }, metadata: { user_id: UID } },
        },
        PRODUCT
      )
    ).toEqual({ userId: UID, plan: "pro" });
  });

  it("tolerates junk events without throwing", () => {
    expect(resolvePlanChange(null, PRODUCT)).toBeNull();
    expect(resolvePlanChange("order.paid", PRODUCT)).toBeNull();
    expect(resolvePlanChange({ type: 42 }, PRODUCT)).toBeNull();
  });
});
