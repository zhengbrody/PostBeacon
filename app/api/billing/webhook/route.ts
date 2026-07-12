import { NextRequest, NextResponse } from "next/server";
import { setPlan } from "@/lib/usage";
import { recordWebhookEvent, resolvePlanChange, verifyWebhook } from "@/lib/billing";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 262_144; // Polar events are small; anything bigger is noise

/**
 * Polar webhook → flip a user's plan. Every request must clear, in order:
 * a configured secret (fail closed), a fresh signed timestamp + HMAC
 * signature (Standard Webhooks scheme), the idempotency ledger (replays are
 * acked but not reprocessed), and event evaluation (allowlisted event types,
 * matching POLAR_PRODUCT_ID, UUID user id) before any state changes.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    // Never process unsigned webhooks. If billing isn't fully configured,
    // this endpoint is closed.
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Body too large" }, { status: 413 });
  }
  const body = await req.text();
  if (body.length > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Body too large" }, { status: 413 });
  }

  const verdict = verifyWebhook(
    {
      id: req.headers.get("webhook-id"),
      timestamp: req.headers.get("webhook-timestamp"),
      signature: req.headers.get("webhook-signature"),
    },
    body,
    secret
  );
  if (!verdict.ok) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }

  // Idempotency: a webhook-id we've already recorded is acked without effect.
  if ((await recordWebhookEvent(verdict.id)) === "duplicate") {
    return NextResponse.json({ received: true });
  }

  const change = resolvePlanChange(event, process.env.POLAR_PRODUCT_ID);
  if (change) await setPlan(change.userId, change.plan);

  return NextResponse.json({ received: true });
}
