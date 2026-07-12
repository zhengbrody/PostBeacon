import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/usage";
import { fetchWithTimeout } from "@/lib/fetch";

const POLAR_API = process.env.POLAR_API_URL || "https://api.polar.sh/v1/checkouts/";

/** Origins we may bounce the user back to after checkout. The Origin header is
 *  attacker-controlled on direct API calls, so it's only honored when it's in
 *  this fixed allowlist; otherwise the canonical SITE_URL wins. */
function successBase(req: NextRequest): string {
  const allowed = (process.env.SITE_URL || "https://postbeacon.app")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const origin = req.headers.get("origin");
  return origin && allowed.includes(origin) ? origin : allowed[0];
}

// Create a Polar checkout session for the Pro plan and return its URL.
// The user id rides along in metadata so the webhook can flip their plan.
export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    }

    const token = process.env.POLAR_ACCESS_TOKEN;
    const productId = process.env.POLAR_PRODUCT_ID;
    if (!token || !productId) {
      return NextResponse.json({ error: "Billing isn't configured." }, { status: 503 });
    }

    const res = await fetchWithTimeout(
      POLAR_API,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          products: [productId],
          success_url: `${successBase(req)}/app?upgraded=1`,
          customer_email: user.email,
          metadata: { user_id: user.id },
        }),
      },
      15000
    );

    // Upstream error details stay server-side; the client only needs "failed".
    if (!res.ok) {
      return NextResponse.json({ error: "Checkout failed" }, { status: 502 });
    }
    const data: unknown = await res.json();
    const url = (data as { url?: unknown })?.url;
    if (typeof url !== "string" || !url.startsWith("https://")) {
      return NextResponse.json({ error: "Checkout failed" }, { status: 502 });
    }
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 });
  }
}
