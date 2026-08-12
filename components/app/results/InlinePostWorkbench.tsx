"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ExecutionProgress } from "./ExecutionProgress";
import { DraftSafetyNotice } from "./DraftSafetyNotice";
import { DraftDecisionSupport } from "./DraftDecisionSupport";
import { publishDestination, type ExecutionStep } from "@/lib/execution";
import { auditDraftSafety, charBudget, platformCharLimit } from "@/lib/contentSafety";
import type {
  Fact,
  PlatformContent,
  PlatformPost,
  PlatformRecommendation,
  ProductProfile,
  SuccessContract,
} from "@/lib/types";

const PREPARE_STEPS: ExecutionStep[] = [
  { id: "prepare", label: "Prepare", done: true, active: false },
  { id: "publish", label: "Publish", done: false, active: true },
  { id: "measure", label: "Measure", done: false, active: false },
  { id: "learn", label: "Learn", done: false, active: false },
];

export function InlinePostWorkbench({
  content,
  facts,
  profile,
  recommendation,
  successContract,
  posted,
  defaultPostIdx,
  loading,
  onUpdatePost,
  onRegenerate,
  onPublish,
  onAskCopilot,
  onOpenLibrary,
}: {
  content: PlatformContent;
  facts: Fact[];
  profile: ProductProfile;
  recommendation?: PlatformRecommendation;
  successContract?: SuccessContract;
  posted: Record<string, boolean>;
  defaultPostIdx?: number;
  loading: boolean;
  onUpdatePost: (platformId: string, idx: number, patch: Partial<PlatformPost>) => void;
  onRegenerate: (platformId: string) => void;
  onPublish: (platformId: string, postIdx: number) => void;
  onAskCopilot: (direction: string) => void;
  onOpenLibrary: () => void;
}) {
  const requestedIsAvailable =
    defaultPostIdx !== undefined &&
    Boolean(content.posts[defaultPostIdx]) &&
    !posted[`${content.platformId}-${defaultPostIdx}`];
  const firstAvailable = requestedIsAvailable
    ? defaultPostIdx
    : Math.max(
        0,
        content.posts.findIndex((_, index) => !posted[`${content.platformId}-${index}`])
      );
  const [postIdx, setPostIdx] = useState(firstAvailable);
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState(
    "Draft ready — prepare it here, then post manually."
  );
  const [hookChange, setHookChange] = useState<{ from: string; to: string }>();
  const wasLoading = useRef(false);
  const previousPostCount = useRef(content.posts.length);
  const previousPlatform = useRef(content.platformId);

  useEffect(() => {
    setPostIdx(firstAvailable);
    setEditing(false);
    setHookChange(undefined);
    setFeedback("Draft ready — prepare it here, then post manually.");
  }, [content.platformId, firstAvailable]);

  useEffect(() => {
    if (wasLoading.current && !loading) setFeedback("Fresh draft generated ✓");
    wasLoading.current = loading;
  }, [loading]);

  useEffect(() => {
    if (previousPlatform.current !== content.platformId) {
      previousPlatform.current = content.platformId;
      previousPostCount.current = content.posts.length;
      return;
    }
    if (content.posts.length > previousPostCount.current) {
      const nextIndex = content.posts.length - 1;
      const previousHook = content.posts[postIdx]?.hook;
      const nextHook = content.posts[nextIndex]?.hook;
      setPostIdx(nextIndex);
      if (previousHook && nextHook && previousHook !== nextHook) {
        setHookChange({ from: previousHook, to: nextHook });
      }
      setFeedback("New variant selected — the deterministic Truth Gate ran again.");
    }
    previousPostCount.current = content.posts.length;
  }, [content.platformId, content.posts, postIdx]);

  const post = content.posts[postIdx] ?? content.posts[0];
  const hooks = useMemo(
    () => Array.from(new Set([post?.hook, ...(post?.hookVariants ?? [])])).filter(Boolean),
    [post?.hook, post?.hookVariants]
  );
  const destination = publishDestination(content.platformId);

  if (!post) return null;

  const safety = auditDraftSafety(post, facts, profile, content.platformId);
  const limit = platformCharLimit(content.platformId);
  const budget = limit ? charBudget(post, limit) : undefined;

  const update = (patch: Partial<PlatformPost>) =>
    onUpdatePost(content.platformId, postIdx, patch);

  async function copyDraft() {
    if (!safety.ready) {
      setFeedback("Truth check blocked copying — edit the highlighted claim first.");
      return;
    }
    setFeedback("Copying draft…");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await Promise.race([
        navigator.clipboard.writeText(`${post.hook}\n\n${post.body}`),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Clipboard timed out")), 1500)
        ),
      ]);
      setFeedback("Copied ✓ Paste it into the platform, then come back to start tracking.");
    } catch {
      setFeedback("Copy failed — select the draft text manually.");
    }
  }

  function openPlatform() {
    if (!destination) {
      setFeedback(
        "No direct compose link for this channel — copy the draft and open it manually."
      );
      return;
    }
    const opened = window.open(destination, "_blank", "noopener,noreferrer");
    setFeedback(
      opened
        ? `${content.platformName} opened in a new tab ✓`
        : `Popup blocked — copy the draft and open ${content.platformName} manually.`
    );
  }

  function switchHook(hook: string) {
    if (hook === post.hook) return;
    setHookChange({ from: post.hook, to: hook });
    update({ hook, hookVariants: hooks.filter((candidate) => candidate !== hook) });
    setFeedback("Variable changed: Hook A → Hook B. Review the receipt before publishing.");
  }

  return (
    <div className="mt-5 space-y-4">
      <ExecutionProgress steps={PREPARE_STEPS} />

      <DraftDecisionSupport
        content={content}
        facts={facts}
        post={post}
        profile={profile}
        recommendation={recommendation}
        successContract={successContract}
        hookChange={hookChange}
      />

      <div className="rounded-xl border border-line bg-black/20">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Recommended draft · {content.platformName}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-neutral-600">
              <span>
                Variant {postIdx + 1} of {content.posts.length}
              </span>
              {budget && (
                <span
                  className={
                    budget.fitsSingle
                      ? "text-neutral-500"
                      : budget.fitsThread
                        ? "text-amber-400/90"
                        : "text-red-400"
                  }
                >
                  {budget.fitsSingle
                    ? `${budget.total}/${budget.limit} chars`
                    : budget.fitsThread
                      ? `${budget.total} chars — post it as a thread (every segment fits ${budget.limit})`
                      : `Longest segment ${budget.longestSegment}/${budget.limit} chars — too long to post`}
                </span>
              )}
            </div>
          </div>
          {content.posts.length > 1 && (
            <div className="flex gap-1" aria-label="Draft variants">
              {content.posts.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    setPostIdx(index);
                    setFeedback(`Draft ${index + 1} selected ✓`);
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                    postIdx === index
                      ? "bg-accent-600 text-white"
                      : "bg-surface-2 text-neutral-400 hover:text-white"
                  }`}
                >
                  {String.fromCharCode(65 + index)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-4">
          {editing ? (
            <div className="space-y-3">
              <label className="block text-xs text-neutral-400">
                Hook
                <textarea
                  value={post.hook}
                  onChange={(event) => update({ hook: event.target.value })}
                  rows={2}
                  className="mt-1 block w-full rounded-md border border-accent-700 bg-surface-2 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-400"
                />
              </label>
              <label className="block text-xs text-neutral-400">
                Body
                <textarea
                  value={post.body}
                  onChange={(event) => update({ body: event.target.value })}
                  rows={8}
                  className="mt-1 block w-full rounded-md border border-accent-700 bg-surface-2 px-3 py-2 text-sm leading-relaxed text-neutral-100 outline-none focus:border-accent-400"
                />
              </label>
            </div>
          ) : (
            <>
              {hooks.length > 1 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {hooks.map((hook, index) => (
                    <button
                      key={`${index}-${hook}`}
                      type="button"
                      onClick={() => switchHook(hook)}
                      className={`rounded-md border px-2.5 py-1 text-left text-xs transition-colors ${
                        hook === post.hook
                          ? "border-accent-500 bg-accent-600/15 text-accent-200"
                          : "border-line text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
                      }`}
                    >
                      {hook.length > 58 ? `${hook.slice(0, 58)}…` : hook}
                    </button>
                  ))}
                </div>
              )}
              <div className="text-sm font-semibold text-accent-200">{post.hook}</div>
              <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-neutral-300">
                {post.body}
              </pre>
              {(post.bestTime || post.imageSuggestion) && (
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-neutral-500">
                  {post.bestTime && <span>Best time: {post.bestTime}</span>}
                  {post.imageSuggestion && <span>Visual: {post.imageSuggestion}</span>}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <DraftSafetyNotice report={safety} />

      {!safety.ready && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-900/50 bg-amber-950/10 px-3 py-2.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onAskCopilot(
                `Repair the current ${content.platformName} draft so it passes the deterministic Truth Gate. Fix only these issue codes: ${safety.issues
                  .map((issue) => issue.code)
                  .join(
                    ", "
                  )}. Preserve every supported factual claim and the selected angle. Propose exactly one generate_variant action with the complete replacement hook and body. Show the before/after diff and do not change the draft until I explicitly apply it.`
              )
            }
          >
            Repair issues with Copilot →
          </Button>
          <p className="text-[11px] leading-relaxed text-neutral-500">
            Copilot proposes a replacement; you see the diff and choose Apply or Dismiss.
            The deterministic gate runs again after an applied change.
          </p>
        </div>
      )}

      <div
        className="rounded-lg border border-accent-800/60 bg-accent-950/30 px-3 py-2 text-xs text-accent-200"
        role="status"
        aria-live="polite"
      >
        {feedback}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!safety.ready}
          title={!safety.ready ? "Fix the truth-check issues before copying" : undefined}
          onClick={copyDraft}
        >
          Copy draft
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setEditing((current) => !current);
            setFeedback(
              editing
                ? "Draft changes saved ✓"
                : "Editing draft — changes save automatically."
            );
          }}
        >
          {editing ? "Done editing" : "Edit draft"}
        </Button>
        <Button variant="outline" onClick={openPlatform}>
          Open {content.platformName}
        </Button>
        <Button
          disabled={loading || !safety.ready}
          title={!safety.ready ? "Fix the truth-check issues before publishing" : undefined}
          onClick={() => onPublish(content.platformId, postIdx)}
        >
          I published it →
        </Button>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-line/70 pt-3 text-xs">
        <button
          type="button"
          className="text-accent-300 hover:underline"
          onClick={() =>
            onAskCopilot(
              "Remove AI tells from this draft without changing any factual claim."
            )
          }
        >
          ✦ De-AI this draft
        </button>
        <button
          type="button"
          className="text-accent-300 hover:underline"
          onClick={() =>
            onAskCopilot(
              "Give this draft a sharper, platform-native hook and explain why it is stronger."
            )
          }
        >
          ✦ Sharpen the hook
        </button>
        <button
          type="button"
          disabled={loading}
          className="text-neutral-500 hover:text-neutral-300 disabled:opacity-40"
          onClick={() => {
            setFeedback("Generating a fresh channel draft…");
            onRegenerate(content.platformId);
          }}
        >
          Regenerate
        </button>
        <button
          type="button"
          className="text-neutral-500 hover:text-neutral-300"
          onClick={onOpenLibrary}
        >
          Open full library
        </button>
      </div>
    </div>
  );
}
