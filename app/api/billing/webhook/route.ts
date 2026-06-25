import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { setPlan } from "@/lib/usage";

export const runtime = "nodejs";

/**
 * Polar webhook → flip a user's plan. Polar signs webhooks with the
 * "Standard Webhooks" scheme (webhook-id / webhook-timestamp / webhook-signature).
 * We verify before trusting the body. Event shapes are handled defensively;
 * confirm against live events when wiring up the Polar account.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  const body = await req.text();

  if (secret && !verifySignature(req, body, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }

  const type: string = event?.type || "";
  const data = event?.data ?? {};
  const userId =
    data?.metadata?.user_id ||
    data?.customer?.metadata?.user_id ||
    data?.subscription?.metadata?.user_id;

  if (userId) {
    const status: string = data?.status || "";
    if (type.startsWith("subscription.")) {
      const active =
        ["active", "trialing"].includes(status) ||
        type === "subscription.active" ||
        type === "subscription.created";
      const ended =
        ["canceled", "revoked", "unpaid", "past_due"].includes(status) ||
        type === "subscription.canceled" ||
        type === "subscription.revoked";
      await setPlan(userId, active && !ended ? "pro" : "free");
    } else if (type === "order.created" || type === "order.paid") {
      await setPlan(userId, "pro");
    }
  }

  return NextResponse.json({ received: true });
}

/** Standard Webhooks HMAC-SHA256 verification. */
function verifySignature(
  req: NextRequest,
  payload: string,
  secret: string
): boolean {
  try {
    const id = req.headers.get("webhook-id");
    const ts = req.headers.get("webhook-timestamp");
    const header = req.headers.get("webhook-signature");
    if (!id || !ts || !header) return false;

    const key = secret.startsWith("whsec_")
      ? Buffer.from(secret.slice(6), "base64")
      : Buffer.from(secret, "utf8");
    const expected = crypto
      .createHmac("sha256", key)
      .update(`${id}.${ts}.${payload}`)
      .digest("base64");

    // header is a space-separated list of "v1,<sig>" entries.
    return header.split(" ").some((part) => {
      const sig = part.includes(",") ? part.split(",")[1] : part;
      return (
        sig.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
      );
    });
  } catch {
    return false;
  }
}
