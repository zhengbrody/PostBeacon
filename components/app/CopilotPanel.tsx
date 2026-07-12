"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { api, type ApiError } from "@/lib/api";
import type {
  CopilotAction,
  CopilotRewrite,
  GenerateResult,
  MarketingStrategy,
  PlatformPost,
  ProductProfile,
  Provider,
} from "@/lib/types";

/**
 * The Launch Copilot drawer: a CMO assistant pinned to the results dashboard.
 * It only answers about the CURRENT plan (the server builds the context from
 * the props below). Transcript is session-scoped by design — nothing persists.
 */

interface PanelMessage {
  role: "user" | "assistant";
  content: string;
  rewrites?: CopilotRewrite[];
}

const QUICK_ACTIONS: { label: string; action: CopilotAction }[] = [
  { label: "Explain this plan", action: "explain-plan" },
  { label: "What's next?", action: "next-steps" },
  { label: "De-AI my posts", action: "improve-posts" },
];

export function CopilotPanel({
  profile,
  strategy,
  result,
  launchDate,
  provider,
  onApplyRewrite,
  onAuthRequired,
}: {
  profile: ProductProfile;
  strategy: MarketingStrategy;
  result: GenerateResult;
  launchDate: string;
  provider: Provider;
  onApplyRewrite: (platformId: string, idx: number, patch: Partial<PlatformPost>) => void;
  onAuthRequired: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [target, setTarget] = useState(result.content[0]?.platformId ?? "");
  const [msgs, setMsgs] = useState<PanelMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Regenerate can reshuffle channels — never point at a platform that's gone.
  const validTarget = result.content.some((c) => c.platformId === target)
    ? target
    : (result.content[0]?.platformId ?? "");
  const targetName =
    result.content.find((c) => c.platformId === validTarget)?.platformName || validTarget;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, busy]);

  async function send(action: CopilotAction, label: string, question?: string) {
    if (busy) return;
    const history = msgs.slice(-6).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: "user", content: label }]);
    setBusy(true);
    setError("");
    try {
      const res = await api.copilot({
        provider,
        profile,
        strategy,
        result,
        launchDate,
        action,
        question,
        targetPlatformId:
          action === "rewrite" || action === "first-replies" ? validTarget : undefined,
        history,
      });
      setMsgs((m) => [
        ...m,
        { role: "assistant", content: res.reply, rewrites: res.rewrites },
      ]);
    } catch (e) {
      const err = e as ApiError;
      if (err?.code === "auth") {
        // Withdraw the optimistic turn and hand off to the sign-in modal.
        setMsgs((m) => m.slice(0, -1));
        onAuthRequired();
      } else {
        setError(err?.message || "Copilot failed");
      }
    } finally {
      setBusy(false);
    }
  }

  function submitFree() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    send(feedbackMode ? "review-feedback" : "ask", q, q);
  }

  function sendRewrite() {
    const direction = input.trim();
    setInput("");
    send(
      "rewrite",
      direction ? `Rewrite for ${targetName}: ${direction}` : `Rewrite for ${targetName}`,
      direction || undefined
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="no-print fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-accent-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent-600/25 transition-colors hover:bg-accent-500"
      >
        ✦ Ask your CMO
      </button>
    );
  }

  return (
    <div className="no-print">
      <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setOpen(false)} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-surface">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <div className="text-sm font-semibold">
              Launch Copilot <span className="text-accent-400">· {profile.name}</span>
            </div>
            <div className="text-xs text-neutral-500">
              Answers from this plan only — not generic advice
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close copilot"
            className="rounded-md px-2 py-1 text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            ✕
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {msgs.length === 0 && (
            <p className="text-xs leading-relaxed text-neutral-500">
              I wrote this launch plan. Ask why a channel ranks where it does, what to do
              first, or paste the comments you got — I&apos;ll read them against the plan. For
              rewrites, I hand back copy-ready versions you can apply to your drafts.
            </p>
          )}
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div
                key={i}
                className="ml-8 rounded-lg bg-surface-2 px-3 py-2 text-sm text-neutral-200"
              >
                {m.content}
              </div>
            ) : (
              <div key={i} className="space-y-3">
                {m.content && (
                  <div>
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-neutral-200">
                      {m.content}
                    </pre>
                    <CopyBtn text={m.content} className="mt-1.5" />
                  </div>
                )}
                {m.rewrites?.map((r, j) => (
                  <RewriteCard key={j} rewrite={r} result={result} onApply={onApplyRewrite} />
                ))}
              </div>
            )
          )}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-accent-300">
              <Spinner /> Thinking through your plan…
            </div>
          )}
          {error && (
            <div className="rounded-md bg-red-950/60 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="space-y-2.5 border-t border-line px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map((qa) => (
              <Button
                key={qa.action}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => send(qa.action, qa.label)}
              >
                {qa.label}
              </Button>
            ))}
          </div>
          {result.content.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={validTarget}
                onChange={(e) => setTarget(e.target.value)}
                aria-label="Target platform"
                className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs text-neutral-100 outline-none transition-colors focus:border-accent-500"
              >
                {result.content.map((c) => (
                  <option key={c.platformId} value={c.platformId}>
                    {c.platformName}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !validTarget}
                onClick={sendRewrite}
              >
                Rewrite
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !validTarget}
                onClick={() => send("first-replies", `First replies for ${targetName}`)}
              >
                First replies
              </Button>
            </div>
          )}
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitFree();
              }
            }}
            placeholder={
              feedbackMode
                ? "Paste the comments or results you got…"
                : 'Ask anything about this launch — "Why Reddit over Product Hunt?"'
            }
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none transition-colors focus:border-accent-500"
          />
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-xs text-neutral-500">
              <input
                type="checkbox"
                checked={feedbackMode}
                onChange={(e) => setFeedbackMode(e.target.checked)}
              />
              I&apos;m pasting feedback I got
            </label>
            <Button size="sm" disabled={busy || !input.trim()} onClick={submitFree}>
              Send
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function RewriteCard({
  rewrite,
  result,
  onApply,
}: {
  rewrite: CopilotRewrite;
  result: GenerateResult;
  onApply: (platformId: string, idx: number, patch: Partial<PlatformPost>) => void;
}) {
  const [applied, setApplied] = useState(false);
  const targetPost =
    rewrite.platformId && rewrite.postIndex != null
      ? result.content.find((c) => c.platformId === rewrite.platformId)?.posts[
          rewrite.postIndex
        ]
      : undefined;

  function apply() {
    if (!rewrite.platformId || rewrite.postIndex == null) return;
    const patch: Partial<PlatformPost> = { body: rewrite.body };
    if (rewrite.hook) patch.hook = rewrite.hook;
    onApply(rewrite.platformId, rewrite.postIndex, patch);
    setApplied(true);
  }

  return (
    <div className="rounded-lg border border-accent-700/50 bg-accent-600/10 p-3">
      <div className="mb-1.5 text-xs font-semibold text-accent-300">{rewrite.label}</div>
      {rewrite.hook && (
        <div className="mb-1 text-sm font-medium text-neutral-100">{rewrite.hook}</div>
      )}
      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-neutral-300">
        {rewrite.body}
      </pre>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CopyBtn
          text={rewrite.hook ? `${rewrite.hook}\n\n${rewrite.body}` : rewrite.body}
        />
        {targetPost &&
          (applied ? (
            <a href={`#ch-${rewrite.platformId}`} className="text-xs text-emerald-400">
              ✓ Applied — view draft
            </a>
          ) : (
            <Button size="sm" onClick={apply}>
              Apply to draft
            </Button>
          ))}
      </div>
    </div>
  );
}

function CopyBtn({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <Button size="sm" variant="outline" onClick={copy} className={className}>
      {copied ? "Copied!" : "Copy"}
    </Button>
  );
}
