import { NextRequest, NextResponse } from "next/server";
import { bearer } from "@/lib/auth";
import { exportAccountData } from "@/lib/account";
import { PublicError } from "@/lib/errors";
import { logError } from "@/lib/log";
import { getUserClient } from "@/lib/supabase/server";
import { getUserFromRequest } from "@/lib/usage";
import { apiError } from "@/lib/validate";

// GET /api/account/export — everything the signed-in user owns, as one JSON
// download. Uses a USER-SCOPED client (their bearer token + anon key), so RLS
// does the scoping and no service-role key is required for this right.
export async function GET(req: NextRequest) {
  try {
    const token = bearer(req);
    const user = token ? await getUserFromRequest(req) : null;
    if (!token || !user) {
      throw new PublicError("Sign in to export your data.", 401);
    }
    const sb = getUserClient(token);
    if (!sb) {
      throw new PublicError("Accounts aren't configured on this deployment.", 503);
    }
    const data = await exportAccountData(sb, {
      id: user.id,
      email: user.email ?? null,
    });
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="postbeacon-account-export.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (!(err instanceof PublicError)) logError("account.export", err);
    return apiError(err, "Export failed. Try again.");
  }
}
