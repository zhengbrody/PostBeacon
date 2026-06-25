"use client";

import { useEffect, useState } from "react";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

/** Single source of truth for the current Supabase user across the app. */
export function useSupabaseUser() {
  const supabase = getSupabase();
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth
      .getUser()
      .then(({ data }) => setUserEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setUserEmail(session?.user?.email ?? null)
    );
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  return { userEmail, supabase };
}

/**
 * Magic-link sign-in — the single auth entry point, reused by the landing Nav
 * and the in-app ProjectBar so there's exactly one OTP implementation. Renders
 * nothing when Supabase isn't configured.
 */
export function SignIn({ redirectTo = "/app" }: { redirectTo?: string }) {
  const { userEmail, supabase } = useSupabaseUser();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  if (!supabaseConfigured()) return null;

  async function sendLink() {
    if (!supabase || !email) return;
    setBusy(true);
    setMsg("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + redirectTo },
    });
    setBusy(false);
    setMsg(error ? error.message : "Check your email for the magic link ✉️");
  }

  if (userEmail) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-neutral-400">{userEmail}</span>
        <button
          onClick={() => supabase?.auth.signOut()}
          className="text-neutral-500 hover:text-neutral-300"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs outline-none focus:border-accent-500"
      />
      <Button size="sm" onClick={sendLink} disabled={busy || !email}>
        Sign in
      </Button>
      {msg && <span className="text-xs text-neutral-400">{msg}</span>}
    </div>
  );
}
