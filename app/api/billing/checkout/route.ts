import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/usage";

const POLAR_API = process.env.POLAR_API_URL || "https://api.polar.sh/v1/checkouts/";

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

    const origin = req.headers.get("origin") || "https://postbeacon.app";
    const res = await fetch(POLAR_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        products: [productId],
        success_url: `${origin}/app?upgraded=1`,
        customer_email: user.email,
        metadata: { user_id: user.id },
      }),
    });

    const data: any = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error || data?.detail || "Checkout failed" },
        { status: 500 }
      );
    }
    return NextResponse.json({ url: data.url });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Checkout failed" },
      { status: 500 }
    );
  }
}
