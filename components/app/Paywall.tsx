"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SignIn } from "./SignIn";
import { api } from "@/lib/api";

// Shown when /api/generate returns 401 (sign in) or 402 (out of free launches).
export function Paywall({
  reason,
  onClose,
}: {
  reason: "auth" | "limit";
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function upgrade() {
    setBusy(true);
    setErr("");
    try {
      const { url } = await api.checkout();
      window.location.href = url;
    } catch (e: any) {
      setErr(e?.message || "Couldn't start checkout.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-md p-6">
        {reason === "auth" ? (
          <>
            <h2 className="text-lg font-semibold">Sign in to generate</h2>
            <p className="mt-1.5 text-sm text-neutral-400">
              Create a free account to generate your launch content and keep your work.
            </p>
            <div className="mt-4 flex justify-start">
              <SignIn redirectTo="/app" />
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">You&apos;re out of free launches</h2>
            <p className="mt-1.5 text-sm text-neutral-400">
              Upgrade to Pro for unlimited launches across every platform.
            </p>
            {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
            <div className="mt-4 flex gap-2">
              <Button onClick={upgrade} disabled={busy}>
                {busy ? "Starting…" : "Upgrade to Pro"}
              </Button>
              <Button variant="outline" onClick={onClose}>
                Maybe later
              </Button>
            </div>
          </>
        )}
        <button
          onClick={onClose}
          className="mt-4 block text-xs text-neutral-500 hover:text-neutral-300"
        >
          Close
        </button>
      </Card>
    </div>
  );
}
