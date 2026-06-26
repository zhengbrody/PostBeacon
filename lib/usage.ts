import { NextRequest, NextResponse } from "next/server";
import {
  authConfigured,
  getServiceSupabase,
  getTokenVerifier,
  meteringEnabled,
} from "./supabase/server";
import { bearer } from "./auth";

// One "full launch" = one successful /api/generate. Free plan gets this many.
export const FREE_LAUNCHES = Number(process.env.FREE_LAUNCHES) || 3;

// Anti-abuse: max expensive LLM-route calls (analyze/strategy/generate/regenerate)
// per user per day. Generous for real use, blocks scripted budget drain.
export const DAILY_LIMIT = Number(process.env.DAILY_LIMIT) || 30;

export interface Entitlement {
  plan: string; // "free" | "pro"
  launchesUsed: number;
}

/** Verify a Supabase access token and return the user (or null). Works with the
 *  anon key, so login is enforceable even without a service-role key. */
export async function getUserFromToken(token?: string | null) {
  const sb = getTokenVerifier();
  if (!sb || !token) return null;
  const { data } = await sb.auth.getUser(token);
  return data.user ?? null;
}

/** Verify the caller from a request's bearer token. The auth seam for routes. */
export async function getUserFromRequest(req: NextRequest) {
  return getUserFromToken(bearer(req));
}

/**
 * One guard for every expensive route: requires sign-in (when accounts are
 * configured) and enforces the per-user daily cap (when metering is on). Returns
 * `{ userId }` on success (userId null when auth is unconfigured → open), or
 * `{ response }` — a ready 401/429 to return immediately.
 */
export async function guardRoute(
  req: NextRequest
): Promise<{ userId: string | null } | { response: NextResponse }> {
  if (!authConfigured()) return { userId: null };
  const user = await getUserFromRequest(req);
  if (!user) {
    return {
      response: NextResponse.json(
        { error: "Sign in to continue.", code: "auth" },
        { status: 401 }
      ),
    };
  }
  if (meteringEnabled() && !(await allowCall(user.id))) {
    return {
      response: NextResponse.json(
        {
          error: `You've hit today's limit of ${DAILY_LIMIT} runs. Try again tomorrow.`,
          code: "limit",
        },
        { status: 429 }
      ),
    };
  }
  return { userId: user.id };
}

/**
 * Per-user daily rate limit across the expensive routes. Returns true and counts
 * the call when allowed; false when the user is over today's cap. No-ops to `true`
 * when there's no service-role store (so the keyless app isn't blocked). Pro plan
 * is unmetered.
 */
export async function allowCall(userId: string): Promise<boolean> {
  const sb = getServiceSupabase();
  if (!sb) return true;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const { data } = await sb
    .from("entitlements")
    .select("plan, calls_today, calls_date")
    .eq("user_id", userId)
    .maybeSingle();
  if ((data?.plan || "free") === "pro") return true;
  const used = data?.calls_date === today ? data?.calls_today ?? 0 : 0;
  if (used >= DAILY_LIMIT) return false;
  await sb.from("entitlements").upsert(
    {
      user_id: userId,
      calls_today: used + 1,
      calls_date: today,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  return true;
}

export async function getEntitlement(userId: string): Promise<Entitlement> {
  const sb = getServiceSupabase();
  if (!sb) return { plan: "free", launchesUsed: 0 };
  const { data } = await sb
    .from("entitlements")
    .select("plan, launches_used")
    .eq("user_id", userId)
    .maybeSingle();
  return { plan: data?.plan || "free", launchesUsed: data?.launches_used ?? 0 };
}

/** True if the user may run another launch under their plan. */
export function canLaunch(ent: Entitlement): boolean {
  return ent.plan === "pro" || ent.launchesUsed < FREE_LAUNCHES;
}

/** Upsert the caller's entitlement row, touching only the given columns. */
async function writeEntitlement(
  userId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const sb = getServiceSupabase();
  if (!sb) return;
  await sb.from("entitlements").upsert(
    { user_id: userId, ...patch, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
}

export async function incrementLaunch(userId: string): Promise<void> {
  const ent = await getEntitlement(userId);
  await writeEntitlement(userId, { launches_used: ent.launchesUsed + 1 });
}

export async function setPlan(userId: string, plan: string): Promise<void> {
  await writeEntitlement(userId, { plan });
}
