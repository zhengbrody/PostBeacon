import { createClient, SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

/** SaaS features (auth + saved projects) only turn on when Supabase is configured. */
export function supabaseConfigured() {
  return !!(URL && ANON);
}

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured()) return null;
  if (!client) {
    client = createClient(URL!, ANON!, {
      auth: { persistSession: true, detectSessionInUrl: true },
    });
  }
  return client;
}
