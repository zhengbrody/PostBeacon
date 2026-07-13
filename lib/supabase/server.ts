import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase clients. The SERVICE ROLE client bypasses RLS (usage
// metering/billing); the anon verifier only validates user JWTs so we can
// enforce login WITHOUT a service-role key. NEVER import service role into client code.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

let client: SupabaseClient | null = null;
let verifier: SupabaseClient | null = null;

/** Login can be enforced server-side whenever the public Supabase keys exist. */
export function authConfigured(): boolean {
  return !!(URL && ANON);
}

/** Usage metering (daily cap + counters) needs the service-role key. */
export function meteringEnabled(): boolean {
  return !!(URL && SERVICE);
}

/** The paid-plan paywall only fires once billing (Polar) is configured — until
 *  then the beta stays free even with metering on. */
export function billingEnabled(): boolean {
  return meteringEnabled() && !!process.env.POLAR_ACCESS_TOKEN;
}

export function getServiceSupabase(): SupabaseClient | null {
  if (!meteringEnabled()) return null;
  if (!client) {
    client = createClient(URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** A lightweight client used only to validate a user's access token (anon key
 *  is enough — getUser(jwt) checks the token against GoTrue). */
export function getTokenVerifier(): SupabaseClient | null {
  if (!authConfigured()) return null;
  if (!verifier) {
    verifier = createClient(URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return verifier;
}

/**
 * A client acting AS the user (anon key + their bearer token), so RLS scopes
 * every query to rows they own. This is how data export works without a
 * service-role key. Per-request — never cached.
 */
export function getUserClient(token: string): SupabaseClient | null {
  if (!authConfigured()) return null;
  return createClient(URL!, ANON!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
