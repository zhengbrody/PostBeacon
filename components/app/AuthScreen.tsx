"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { GoogleButton } from "./SignIn";

/**
 * The full sign-in gate shown at /app when login is required and the visitor
 * isn't authenticated. Google is the primary path; magic link is the fallback.
 * `onDemo` lets people explore the example without an account (kept for
 * conversion — see, then sign in to make their own).
 */
export function AuthScreen({ onDemo }: { onDemo?: () => void }) {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendLink() {
    const supabase = getSupabase();
    if (!supabase || !email) return;
    setBusy(true);
    setMsg("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + "/app" },
    });
    setBusy(false);
    setMsg(error ? error.message : "Check your email for the magic link ✉️");
  }

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <div className="rounded-xl border border-line bg-surface/60 p-7 text-center">
        <h1 className="text-lg font-semibold">Sign in to PostBeacon</h1>
        <p className="mt-1.5 text-sm text-neutral-400">
          Build your launch plan and keep every project in one place.
        </p>

        <div className="mt-6">
          <GoogleButton redirectTo="/app" className="w-full" />
        </div>

        <div className="my-5 flex items-center gap-3 text-xs text-neutral-600">
          <span className="h-px flex-1 bg-line" /> or
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="space-y-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && email && !busy && sendLink()}
            placeholder="you@email.com"
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent-500"
          />
          <Button onClick={sendLink} disabled={busy || !email} className="w-full">
            {busy ? "Sending…" : "Email me a magic link"}
          </Button>
          {msg && <p className="text-xs text-neutral-400">{msg}</p>}
        </div>
      </div>

      {onDemo && (
        <p className="mt-4 text-center text-xs text-neutral-500">
          Just looking?{" "}
          <button onClick={onDemo} className="text-accent-300 hover:underline">
            See an example plan
          </button>{" "}
          — no account needed.
        </p>
      )}
    </div>
  );
}
