import { NextRequest, NextResponse } from "next/server";
import { meteringEnabled } from "@/lib/supabase/server";
import { getUserFromRequest, getEntitlement, FREE_LAUNCHES } from "@/lib/usage";

// Current plan + remaining free launches for the signed-in user. Returns
// { enabled:false } when metering is off so the UI can hide the indicator.
export async function GET(req: NextRequest) {
  if (!meteringEnabled()) {
    return NextResponse.json({ enabled: false });
  }
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ enabled: true, signedIn: false });
  }
  const ent = await getEntitlement(user.id);
  return NextResponse.json({
    enabled: true,
    signedIn: true,
    plan: ent.plan,
    used: ent.launchesUsed,
    limit: FREE_LAUNCHES,
    remaining: ent.plan === "pro" ? null : Math.max(0, FREE_LAUNCHES - ent.launchesUsed),
  });
}
