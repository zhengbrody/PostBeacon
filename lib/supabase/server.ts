import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client using the SERVICE ROLE key. Bypasses RLS so the
// server can trust-count usage and flip plans. NEVER import this into client code.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

let client: SupabaseClient | null = null;

/** Metering/billing is only enforced when the server has a service-role key. */
export function meteringEnabled(): boolean {
  return !!(URL && SERVICE);
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
