import type { NextRequest } from "next/server";
import { getServiceSupabase, getTokenVerifier } from "./supabase/server";
import { bearer } from "./auth";

// One "full launch" = one successful /api/generate. Free plan gets this many.
export const FREE_LAUNCHES = 3;

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
