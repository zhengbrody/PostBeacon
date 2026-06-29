"use client";

import { useEffect, useState } from "react";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

/** Single source of truth for the current Supabase user across the app. */
export function useSupabaseUser() {
  const supabase = getSupabase();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    // onAuthStateChange emits the initial session (after Supabase has processed
    // any OAuth/magic-link tokens in the URL), so it's the single signal we need
    // — using it for the first read avoids a gate flash on OAuth return. It also
    // re-fires on USER_UPDATED, so the display name stays fresh after an edit.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserEmail(session?.user?.email ?? null);
      setDisplayName(
        (session?.user?.user_metadata?.display_name as string) || null
      );
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  /** Persist a custom display name to Supabase user metadata (empty string clears it). */
  async function updateDisplayName(name: string): Promise<{ error?: string }> {
    if (!supabase) return { error: "Accounts are not configured." };
    const display_name = name.trim();
    const { error } = await supabase.auth.updateUser({ data: { display_name } });
    if (error) return { error: error.message };
    setDisplayName(display_name || null);
    return {};
  }

  return { userEmail, displayName, supabase, loading, updateDisplayName };
}

/**
 * Account label (custom display name, falling back to email) with a small inline
 * editor — the "change your account name" setting. Click the name to rename.
 */
export function AccountName({
  email,
  name,
  onSave,
}: {
  email: string;
  name: string | null;
  onSave: (name: string) => Promise<{ error?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function open() {
    setDraft(name ?? "");
    setErr("");
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    const { error } = await onSave(draft);
    setBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="flex items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder={email}
          className="w-36 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs outline-none focus:border-accent-500"
        />
        <button
          onClick={save}
          disabled={busy}
          className="text-accent-300 hover:text-accent-200 disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={() => setEditing(false)}
          className="text-neutral-500 hover:text-neutral-300"
        >
          Cancel
        </button>
        {err && <span className="text-red-400">{err}</span>}
      </span>
    );
  }

  return (
    <button
      onClick={open}
      title="Edit display name"
      className="text-neutral-400 hover:text-neutral-200"
    >
      {name || email}
    </button>
  );
}

/** Kick off Google OAuth. Supabase redirects to Google and back to `redirectTo`. */
export async function signInWithGoogle(redirectTo = "/app") {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + redirectTo },
  });
}

/** "Continue with Google" button with the Google mark. */
export function GoogleButton({
  redirectTo = "/app",
  className = "",
}: {
  redirectTo?: string;
  className?: string;
}) {
  return (
    <button
      onClick={() => signInWithGoogle(redirectTo)}
      className={`inline-flex items-center justify-center gap-2.5 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-100 ${className}`}
    >
      <GoogleMark />
      Continue with Google
    </button>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * Compact sign-in (Google + magic link) for the header / landing nav. The full
 * gate uses AuthScreen; this stays small for places where auth is secondary.
 * Renders nothing when Supabase isn't configured.
 */
export function SignIn({ redirectTo = "/app" }: { redirectTo?: string }) {
  const { userEmail, displayName, supabase } = useSupabaseUser();
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
        <span className="text-neutral-400">{displayName || userEmail}</span>
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
      <GoogleButton redirectTo={redirectTo} className="!px-3 !py-1.5 !text-xs" />
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
