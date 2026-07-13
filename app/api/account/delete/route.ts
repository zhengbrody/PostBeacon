import { NextRequest, NextResponse } from "next/server";
import { deleteAccountData } from "@/lib/account";
import { PublicError } from "@/lib/errors";
import { logError } from "@/lib/log";
import { getServiceSupabase } from "@/lib/supabase/server";
import { getUserFromRequest } from "@/lib/usage";
import { apiError, deleteAccountBodySchema, parseBody, readJsonBody } from "@/lib/validate";

// POST /api/account/delete — erase the caller's account: projects (cascading
// campaigns → experiments → outcomes → tasks, plus meta-carried workspace/
// memory), entitlements, then the auth user itself. Needs the service-role
// key; without it this FAILS CLOSED (503) rather than half-deleting and
// pretending — the UI surfaces that honestly.
export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) throw new PublicError("Sign in to delete your account.", 401);
    parseBody(deleteAccountBodySchema, await readJsonBody(req));

    const sb = getServiceSupabase();
    if (!sb) {
      throw new PublicError(
        "This deployment can't perform full account deletion yet — contact us and we'll do it manually.",
        503
      );
    }
    await deleteAccountData(sb, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (!(err instanceof PublicError)) logError("account.delete", err);
    return apiError(err, "Account deletion failed. Try again.");
  }
}
