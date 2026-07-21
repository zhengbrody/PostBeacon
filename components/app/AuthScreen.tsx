"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { getSupabase } from "@/lib/supabase/client";
import {
  clearPreviewHandoff,
  createPreviewHandoff,
  loadPreviewHandoff,
  markPreviewHandoffAuthPending,
  savePreviewHandoff,
} from "@/lib/previewHandoff";
import type {
  GuestPreviewProviderCapability,
  GuestPreviewResult,
  Provider,
} from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { GoogleButton } from "./SignIn";

const PROVIDER_LABEL: Record<Provider, string> = {
  claude: "Claude",
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

function ProviderReceipt({ preview }: { preview: GuestPreviewResult }) {
  const runs = [
    preview.provenance.analysis,
    ...preview.provenance.scoring,
    preview.provenance.content,
  ];
  const providers = Array.from(new Set(runs.map((run) => PROVIDER_LABEL[run.provider])));
  const fallbacks = Array.from(
    new Set(
      runs.flatMap((run) =>
        run.fallbackFrom
          ? [`${PROVIDER_LABEL[run.fallbackFrom]} → ${PROVIDER_LABEL[run.provider]}`]
          : []
      )
    )
  );
  return (
    <p className="text-[11px] leading-relaxed text-neutral-500">
      Completed by {providers.join(" + ")}.
      {fallbacks.length > 0
        ? ` Provider retry: ${fallbacks.join(", ")}; the first provider may already have received the page text.`
        : " No provider retry was needed."}
    </p>
  );
}

function GuestPreviewCard({
  preview,
  stored,
  onClear,
}: {
  preview: GuestPreviewResult;
  stored: boolean;
  onClear: () => void;
}) {
  return (
    <Card className="border-accent-700/50 bg-accent-950/10 p-5 text-left">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-300">
            Your one-channel preview
          </p>
          <h2 className="mt-1 text-xl font-semibold text-neutral-100">
            {preview.product.name}
          </h2>
          <p className="mt-1 text-sm text-neutral-400">{preview.product.valueProp}</p>
          <p className="mt-1 text-xs text-neutral-600">Source: {preview.source.hostname}</p>
        </div>
        <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
          Truth check passed
        </span>
      </div>

      <div className="mt-5 rounded-lg border border-line bg-surface-2/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-neutral-100">
            Best first test: {preview.channel.platformName}
          </h3>
          <span className="text-xs text-accent-300">fit {preview.channel.score}/100</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-neutral-400">
          {preview.channel.rationale}
        </p>
        <p className="mt-2 text-xs text-neutral-500">Angle: {preview.channel.angle}</p>
      </div>

      <div className="mt-4 rounded-lg border border-line bg-surface-2/60 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Ready-to-review draft
        </p>
        <h3 className="mt-2 font-semibold text-neutral-100">{preview.draft.hook}</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-neutral-300">
          {preview.draft.body}
        </p>
        {preview.draft.caveats && (
          <p className="mt-3 text-xs leading-relaxed text-amber-300/80">
            Watch out: {preview.draft.caveats}
          </p>
        )}
      </div>

      <div className="mt-4 space-y-2">
        <ProviderReceipt preview={preview} />
        <p className="text-[11px] leading-relaxed text-neutral-500">
          {stored
            ? "Kept in this browser for up to 1 hour so you can continue after signing in. It is not written to the project database until you explicitly continue in your account."
            : "Browser storage is unavailable. You can use this result in the current tab, but it may not survive sign-in or refresh."}
        </p>
        <button
          type="button"
          onClick={onClear}
          className="min-h-11 text-xs text-neutral-400 underline-offset-4 hover:text-neutral-200 hover:underline"
        >
          Clear this preview
        </button>
      </div>
    </Card>
  );
}

/** Signed-out first-value screen: one protected preview before the account
 * boundary, followed by explicit sign-in to build and persist the full plan. */
export function AuthScreen({ onDemo }: { onDemo?: () => void }) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<GuestPreviewResult | null>(null);
  const [previewStored, setPreviewStored] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewCapability, setPreviewCapability] =
    useState<GuestPreviewProviderCapability | null>(null);
  const [deepseekConsent, setDeepseekConsent] = useState(false);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const previewAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    api
      .providers()
      .then((result) => setPreviewCapability(result.guestPreview ?? null))
      .catch(() => setPreviewCapability(null));
  }, []);

  useEffect(() => {
    const handoff = loadPreviewHandoff();
    if (!handoff) return;
    setUrl(handoff.url);
    setPreview(handoff.preview);
    setPreviewStored(true);
  }, []);

  useEffect(() => () => previewAbort.current?.abort(), []);

  function authRedirectPath(): string {
    if (!previewStored) return "/app";
    const nonce = markPreviewHandoffAuthPending();
    return nonce ? `/app?preview_handoff=${encodeURIComponent(nonce)}` : "/app";
  }

  async function runPreview() {
    if (!url.trim() || previewBusy) return;
    setPreview(null);
    setPreviewStored(false);
    clearPreviewHandoff();
    setPreviewBusy(true);
    setPreviewError("");
    const controller = new AbortController();
    previewAbort.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 90_000);
    try {
      const result = await api.guestPreview(url.trim(), deepseekConsent, controller.signal);
      setPreview(result);
      setUrl(result.source.url);
      setPreviewStored(savePreviewHandoff(createPreviewHandoff(result.source.url, result)));
    } catch (error) {
      if (controller.signal.aborted) {
        setPreviewError(
          timedOut
            ? "The preview took too long. Your URL is still here, but this attempt may still count toward the preview limit."
            : "Stopped waiting. Your URL is still here; processing may already have used this preview attempt."
        );
      } else {
        setPreviewError(
          error instanceof Error
            ? error.message
            : "The preview could not be created. Try again."
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (previewAbort.current === controller) previewAbort.current = null;
      setPreviewBusy(false);
    }
  }

  async function sendLink() {
    const supabase = getSupabase();
    if (!supabase || !email) return;
    setBusy(true);
    setMsg("");
    const redirectPath = authRedirectPath();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + redirectPath },
    });
    setBusy(false);
    setMsg(error ? error.message : "Check your email for the magic link.");
  }

  const previewEnabled = previewCapability?.enabled === true;
  const deepseekWarningRequired = previewCapability?.deepseek.priorWarningRequired === true;
  const providerRoute = previewCapability?.primaryProvider
    ? [
        PROVIDER_LABEL[previewCapability.primaryProvider],
        ...previewCapability.eligibleFallbackProviders.map(
          (provider) => PROVIDER_LABEL[provider]
        ),
      ]
    : [];
  const canRunPreview =
    Boolean(url.trim()) && (!deepseekWarningRequired || deepseekConsent);

  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-6">
      <section className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-300">
          {previewEnabled
            ? "One useful answer before sign-in"
            : "Evidence-first growth workspace"}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-neutral-100 sm:text-4xl">
          {previewEnabled
            ? "Find your next growth experiment"
            : "Build your next growth experiment"}
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-neutral-400">
          {previewEnabled
            ? "Paste a public product page. PostBeacon will return one best-fit channel, why it fits, and one truth-checked draft—not a sprawling report."
            : "Sign in to verify your product facts, choose one focused experiment, and learn what to do from the result."}
        </p>
      </section>

      {previewEnabled && (
        <Card className="p-5 sm:p-6">
          <label htmlFor="guest-preview-url" className="mb-2 block text-sm font-medium">
            Product URL
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="guest-preview-url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                if (preview) {
                  setPreview(null);
                  setPreviewStored(false);
                  clearPreviewHandoff();
                }
              }}
              onKeyDown={(event) =>
                event.key === "Enter" && canRunPreview && !previewBusy && void runPreview()
              }
              placeholder="yourproduct.com"
              inputMode="url"
              autoCapitalize="none"
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm outline-none transition-colors focus:border-accent-500"
            />
            {previewBusy ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => previewAbort.current?.abort()}
                className="min-h-11 sm:min-w-44"
              >
                <span className="flex items-center justify-center gap-2">
                  <Spinner /> Stop waiting
                </span>
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => void runPreview()}
                disabled={!canRunPreview}
                className="min-h-11 sm:min-w-44"
              >
                Preview my next move →
              </Button>
            )}
          </div>
          {previewError && (
            <p
              className="mt-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300"
              role="alert"
            >
              {previewError}
            </p>
          )}
          <p className="mt-4 text-[11px] leading-relaxed text-neutral-500">
            We fetch this URL server-side and send the extracted page text to
            {providerRoute.length > 0
              ? ` ${providerRoute.join(" or ")}`
              : " a configured AI provider"}
            . A failed provider may receive it before an eligible retry provider. Anonymous
            previews are quota-limited and are not saved as projects. No auto-posting.{" "}
            <Link href="/privacy" className="underline hover:text-accent-300">
              Privacy
            </Link>
          </p>
          {deepseekWarningRequired && previewCapability && (
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-amber-700/40 bg-amber-950/25 p-3 text-left text-xs leading-relaxed text-amber-200/90">
              <input
                type="checkbox"
                checked={deepseekConsent}
                onChange={(event) => setDeepseekConsent(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
              />
              <span>
                I understand this preview may send the extracted page text to DeepSeek.{" "}
                {previewCapability.deepseek.notice}{" "}
                <a
                  href={previewCapability.deepseek.policyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-amber-100"
                >
                  Provider policy
                </a>
                .
              </span>
            </label>
          )}
        </Card>
      )}

      {preview && (
        <GuestPreviewCard
          preview={preview}
          stored={previewStored}
          onClear={() => {
            setPreview(null);
            setPreviewStored(false);
            clearPreviewHandoff();
          }}
        />
      )}

      <section className="rounded-xl border border-line bg-surface/60 p-6 text-center">
        <h2 className="text-lg font-semibold">
          {preview ? "Continue with this preview" : "Already ready to build?"}
        </h2>
        <p className="mt-1.5 text-sm text-neutral-400">
          Sign in to verify the full fact ledger, edit the strategy, run the experiment, and
          save what you learn.
        </p>

        <div className="mt-5">
          <GoogleButton
            redirectTo="/app"
            onBeforeSignIn={authRedirectPath}
            className="min-h-11 w-full"
          />
        </div>

        <div className="my-5 flex items-center gap-3 text-xs text-neutral-600">
          <span className="h-px flex-1 bg-line" /> or
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="space-y-2">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) =>
              event.key === "Enter" && email && !busy && void sendLink()
            }
            placeholder="you@email.com"
            type="email"
            autoComplete="email"
            className="min-h-11 w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent-500"
          />
          <Button
            onClick={() => void sendLink()}
            disabled={busy || !email}
            className="min-h-11 w-full"
          >
            {busy ? "Sending…" : "Email me a magic link"}
          </Button>
          {msg && (
            <p className="text-xs text-neutral-400" role="status">
              {msg}
            </p>
          )}
        </div>

        <p className="mt-5 text-[11px] leading-relaxed text-neutral-500">
          By continuing you agree to the{" "}
          <Link href="/terms" className="text-neutral-400 hover:text-accent-300">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-neutral-400 hover:text-accent-300">
            Privacy Policy
          </Link>
          . PostBeacon never posts for you.
        </p>
      </section>

      {onDemo && (
        <p className="pb-4 text-center text-sm text-neutral-500">
          Prefer to explore first?{" "}
          <button
            type="button"
            onClick={onDemo}
            className="min-h-11 text-accent-300 underline-offset-4 hover:underline"
          >
            Try the fictional 3-minute walkthrough
          </button>{" "}
          — no account or model call.
        </p>
      )}
    </div>
  );
}
