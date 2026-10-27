import { NextRequest, NextResponse } from "next/server";
import {
  authConfigured,
  authConfigurationPresent,
  getServiceSupabase,
  getTokenVerifier,
  meteringEnabled,
} from "./supabase/server";
import { bearer } from "./auth";
import { PublicError, type ApiErrorBody } from "./errors";

// One "full launch" = one successful /api/generate. Free plan gets this many.
export const FREE_LAUNCHES = Number(process.env.FREE_LAUNCHES) || 3;

// Anti-abuse: max expensive LLM-route calls (analyze/strategy/generate/regenerate)
// per user per day. Generous for real use, blocks scripted budget drain.
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT) || 30;

const usageUnavailable = () =>
  new PublicError("Usage tracking is unavailable. Try again later.", 503);

function usageStore() {
  const sb = getServiceSupabase();
  if (!sb && meteringEnabled()) throw usageUnavailable();
  return sb;
}

export interface Entitlement {
  plan: string; // "free" | "pro"
  launchesUsed: number;
}

/** Verify a Supabase access token and return the user (or null). Works with the
 *  anon key, so login is enforceable even without a service-role key. */
async function getUserFromToken(token?: string | null) {
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
  if (!authConfigured()) {
    if (authConfigurationPresent()) throw usageUnavailable();
    return { userId: null };
  }
  const user = await getUserFromRequest(req);
  if (!user) {
    return {
      response: NextResponse.json(
        { error: "Sign in to continue.", code: "auth" } satisfies ApiErrorBody,
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
        } satisfies ApiErrorBody,
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
async function allowCall(userId: string): Promise<boolean> {
  const sb = usageStore();
  if (!sb) return true;
  if (!Number.isInteger(DAILY_LIMIT) || DAILY_LIMIT < 1 || DAILY_LIMIT > 100_000)
    throw usageUnavailable();
  try {
    // The database owns the UTC day, row lock and increment. There is no
    // read/modify/upsert fallback if this migration or storage is unavailable.
    const { data, error } = await sb.rpc("postbeacon_reserve_daily_call", {
      p_user_id: userId,
      p_limit: DAILY_LIMIT,
    });
    if (error || typeof data !== "boolean") throw usageUnavailable();
    return data;
  } catch {
    throw usageUnavailable();
  }
}

export async function getEntitlement(userId: string): Promise<Entitlement> {
  const sb = usageStore();
  if (!sb) return { plan: "free", launchesUsed: 0 };
  try {
    const { data, error } = await sb
      .from("entitlements")
      .select("plan, launches_used")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw usageUnavailable();
    if (data === null) return { plan: "free", launchesUsed: 0 };
    if (
      !data ||
      !["free", "pro"].includes(data.plan) ||
      !Number.isSafeInteger(data.launches_used) ||
      data.launches_used < 0
    )
      throw usageUnavailable();
    return { plan: data.plan, launchesUsed: data.launches_used };
  } catch {
    throw usageUnavailable();
  }
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
  const sb = usageStore();
  if (!sb) return;
  try {
    const { error } = await sb
      .from("entitlements")
      .upsert(
        { user_id: userId, ...patch, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    if (error) throw usageUnavailable();
  } catch {
    throw usageUnavailable();
  }
}

export async function incrementLaunch(userId: string): Promise<void> {
  const sb = usageStore();
  if (!sb) return;
  try {
    const { data, error } = await sb.rpc("postbeacon_increment_launch", {
      p_user_id: userId,
    });
    if (error || !Number.isSafeInteger(data) || data < 1) throw usageUnavailable();
  } catch {
    throw usageUnavailable();
  }
}

export async function setPlan(userId: string, plan: string): Promise<void> {
  if (plan !== "free" && plan !== "pro") throw new PublicError("Unknown plan.", 400);
  await writeEntitlement(userId, { plan });
}
