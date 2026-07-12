import crypto from "node:crypto";
import { getServiceSupabase } from "./supabase/server";

/**
 * Polar webhook verification + event evaluation, kept pure (no framework
 * types) so it's directly unit-testable. The route in
 * app/api/billing/webhook/route.ts is thin glue over these.
 *
 * Polar signs with the "Standard Webhooks" scheme: HMAC-SHA256 over
 * `${webhook-id}.${webhook-timestamp}.${body}`, signature(s) in the
 * `webhook-signature` header as space-separated "v1,<base64>" entries.
 */

/** Max accepted clock skew between the webhook timestamp and now. */
export const WEBHOOK_TOLERANCE_S = 300;

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type WebhookVerification =
  | { ok: true; id: string }
  | { ok: false; reason: "missing-headers" | "stale-timestamp" | "bad-signature" };

/** Verify signature AND timestamp freshness (replay window). */
export function verifyWebhook(
  headers: WebhookHeaders,
  payload: string,
  secret: string,
  nowMs = Date.now()
): WebhookVerification {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing-headers" };

  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return { ok: false, reason: "stale-timestamp" };
  if (Math.abs(nowMs / 1000 - ts) > WEBHOOK_TOLERANCE_S) {
    return { ok: false, reason: "stale-timestamp" };
  }

  const key = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice(6), "base64")
    : Buffer.from(secret, "utf8");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${ts}.${payload}`)
    .digest();

  const match = signature.split(" ").some((part) => {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(sig, "base64");
    } catch {
      return false;
    }
    return (
      candidate.length === expected.length &&
      crypto.timingSafeEqual(candidate, expected)
    );
  });
  return match ? { ok: true, id } : { ok: false, reason: "bad-signature" };
}

/** The only event types that may change a plan. Anything else is ignored. */
export const HANDLED_EVENT_TYPES = new Set([
  "subscription.created",
  "subscription.active",
  "subscription.updated",
  "subscription.uncanceled",
  "subscription.canceled",
  "subscription.revoked",
  "order.created",
  "order.paid",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Every place a Polar payload may carry the purchased product's id. */
function eventProductIds(data: Rec): string[] {
  return [
    str(data.product_id),
    str(rec(data.product).id),
    str(rec(data.subscription).product_id),
    str(rec(data.checkout).product_id),
  ].filter(Boolean);
}

export interface PlanChange {
  userId: string;
  plan: "pro" | "free";
}

/**
 * Decide what (if anything) a verified webhook event changes. Fail-closed:
 * unknown event type, missing/mismatched product id, or a user id that isn't
 * a UUID all resolve to "do nothing".
 */
export function resolvePlanChange(
  event: unknown,
  configuredProductId: string | undefined
): PlanChange | null {
  const e = rec(event);
  const type = str(e.type);
  if (!HANDLED_EVENT_TYPES.has(type)) return null;
  if (!configuredProductId) return null; // can't verify the product → don't act

  const data = rec(e.data);
  if (!eventProductIds(data).includes(configuredProductId)) return null;

  const userId =
    str(rec(data.metadata).user_id) ||
    str(rec(rec(data.customer).metadata).user_id) ||
    str(rec(rec(data.subscription).metadata).user_id);
  if (!UUID_RE.test(userId)) return null;

  if (type.startsWith("subscription.")) {
    const status = str(data.status);
    const active =
      ["active", "trialing"].includes(status) ||
      type === "subscription.active" ||
      type === "subscription.created";
    const ended =
      ["canceled", "revoked", "unpaid", "past_due"].includes(status) ||
      type === "subscription.canceled" ||
      type === "subscription.revoked";
    return { userId, plan: active && !ended ? "pro" : "free" };
  }
  return { userId, plan: "pro" }; // order.created / order.paid
}

/**
 * Idempotency ledger: record a webhook-id, reporting whether it was already
 * processed. "unavailable" (no service store / table missing) lets the caller
 * proceed — plan flips are themselves idempotent, this just blocks replays.
 */
export async function recordWebhookEvent(
  id: string
): Promise<"new" | "duplicate" | "unavailable"> {
  const sb = getServiceSupabase();
  if (!sb) return "unavailable";
  const { error } = await sb.from("webhook_events").insert({ id: id.slice(0, 256) });
  if (!error) return "new";
  return error.code === "23505" ? "duplicate" : "unavailable";
}
