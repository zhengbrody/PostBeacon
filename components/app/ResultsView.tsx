"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { PriorityBadge } from "@/components/ui/Badge";
import {
  AudienceCard,
  FounderChecklistCard,
  IterationCard,
  LaunchPlanCard,
  PositioningCard,
  RisksCard,
} from "@/components/app/PlanSummary";
import { scheduleDate } from "@/lib/dates";
import { toMarkdown, toJson, downloadFile, type ExportSnapshot } from "@/lib/export";
import type {
  GenerateResult,
  MarketingStrategy,
  PlatformContent,
  PlatformPost,
  ProductProfile,
} from "@/lib/types";

export function ResultsView({
  result,
  strategy,
  profile,
  posted,
  onTogglePosted,
  onRegenerate,
  onUpdatePost,
  launchDate,
  setLaunchDate,
  loading,
  onReset,
}: {
  result: GenerateResult;
  strategy: MarketingStrategy | null;
  profile: ProductProfile | null;
  posted: Record<string, boolean>;
  onTogglePosted: (id: string) => void;
  onRegenerate: (platformId: string) => void;
  onUpdatePost: (platformId: string, idx: number, patch: Partial<PlatformPost>) => void;
  launchDate: string;
  setLaunchDate: (v: string) => void;
  loading: boolean;
  onReset: () => void;
}) {
  function exportSnapshot(): ExportSnapshot {
    return { url: undefined, profile, strategy, result, launchDate };
  }
  const slug = useMemo(
    () =>
      (profile?.name || "launch-plan")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, ""),
    [profile?.name]
  );

  // Only the channels we actually wrote content for, in their ranked order.
  const rankedSelected = useMemo(() => {
    if (!strategy) return [];
    const has = new Set(result.content.map((c) => c.platformId));
    return strategy.recommendations.filter((r) => has.has(r.platformId));
  }, [strategy, result.content]);

  const sections = [
    strategy && { id: "summary", label: "Summary" },
    strategy?.audienceSegments?.length && { id: "audience", label: "Audience" },
    rankedSelected.length && { id: "channels", label: "Channels" },
    strategy?.phases?.length && { id: "plan", label: "Plan" },
    { id: "calendar", label: "Calendar" },
    { id: "content", label: "Content" },
    strategy?.founderChecklist?.length && { id: "checklist", label: "Checklist" },
    strategy?.risks?.length && { id: "risks", label: "Risks" },
    strategy?.iterationLoop?.length && { id: "iterate", label: "Iterate" },
  ].filter(Boolean) as { id: string; label: string }[];

  return (
    <div className="space-y-8">
      {/* Section nav — fast jumps around the operating plan */}
      <nav className="no-print -mx-1 flex flex-wrap gap-1.5 border-b border-line pb-3 text-xs">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-md px-2.5 py-1 text-neutral-400 transition-colors hover:bg-surface-2 hover:text-neutral-100"
          >
            {s.label}
          </a>
        ))}
      </nav>

      {strategy && (
        <section id="summary" className="scroll-mt-4">
          <PositioningCard strategy={strategy} />
        </section>
      )}

      {strategy?.audienceSegments && strategy.audienceSegments.length > 0 && (
        <section id="audience" className="scroll-mt-4">
          <AudienceCard segments={strategy.audienceSegments} />
        </section>
      )}

      {rankedSelected.length > 0 && (
        <section id="channels" className="scroll-mt-4">
          <Card className="p-6">
            <h2 className="mb-4 text-lg font-semibold">Your channels, ranked</h2>
            <div className="space-y-2">
              {rankedSelected.map((r) => (
                <div
                  key={r.platformId}
                  className="flex items-start gap-3 rounded-lg bg-surface-2 px-4 py-2.5"
                >
                  <span className="mt-0.5 font-mono text-xs text-neutral-500">
                    {r.score}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <a
                        href={`#ch-${r.platformId}`}
                        className="text-sm font-medium text-neutral-100 hover:text-accent-300"
                      >
                        {r.platformName}
                      </a>
                      <PriorityBadge priority={r.priority} />
                    </span>
                    {r.bestMove && (
                      <span className="mt-1 block text-xs text-neutral-400">
                        <span className="text-neutral-500">Best move:</span>{" "}
                        {r.bestMove}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}

      {strategy?.phases && strategy.phases.length > 0 && (
        <section id="plan" className="scroll-mt-4">
          <LaunchPlanCard phases={strategy.phases} />
        </section>
      )}

      <section id="calendar" className="scroll-mt-4">
        <Card className="p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">📅 Launch calendar</h2>
            <label className="no-print flex items-center gap-2 text-xs text-neutral-400">
              Launch day
              <input
                type="date"
                value={launchDate}
                onChange={(e) => setLaunchDate(e.target.value)}
                className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-accent-500"
              />
            </label>
          </div>
          <ol className="relative space-y-2 border-l border-line pl-5">
            {result.schedule.map((s, i) => {
              const date = scheduleDate(launchDate, s.day);
              return (
                <li key={i} className="relative">
                  <span className="absolute -left-[1.42rem] top-2 h-2 w-2 rounded-full bg-accent-500" />
                  <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-4 py-2.5 text-sm">
                    <span className="shrink-0 rounded-md bg-accent-700/40 px-2 py-1 text-xs font-medium text-accent-200">
                      Day {s.day}
                      {date && <span className="ml-1 text-accent-300/80">· {date}</span>}
                    </span>
                    <span className="text-neutral-300">{s.action}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      </section>

      <section id="content" className="scroll-mt-4 space-y-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-accent-300">
          Content library
        </h2>
        {result.content.map((c) => (
          <ChannelBlock
            key={c.platformId}
            content={c}
            posted={posted}
            loading={loading}
            onTogglePosted={onTogglePosted}
            onRegenerate={() => onRegenerate(c.platformId)}
            onUpdatePost={onUpdatePost}
          />
        ))}
      </section>

      {strategy?.founderChecklist && strategy.founderChecklist.length > 0 && (
        <section id="checklist" className="scroll-mt-4">
          <FounderChecklistCard tasks={strategy.founderChecklist} />
        </section>
      )}

      {strategy?.risks && strategy.risks.length > 0 && (
        <section id="risks" className="scroll-mt-4">
          <RisksCard risks={strategy.risks} />
        </section>
      )}

      {strategy?.iterationLoop && strategy.iterationLoop.length > 0 && (
        <section id="iterate" className="scroll-mt-4">
          <IterationCard metrics={strategy.iterationLoop} />
        </section>
      )}

      <div className="no-print flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadFile(`${slug}.md`, toMarkdown(exportSnapshot()), "text/markdown")
          }
        >
          ⬇ Markdown
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadFile(`${slug}.json`, toJson(exportSnapshot()), "application/json")
          }
        >
          ⬇ JSON
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          🖨 Print / PDF
        </Button>
        <Button variant="outline" size="sm" onClick={onReset} className="ml-auto">
          ← New product
        </Button>
      </div>
    </div>
  );
}

function ChannelBlock({
  content,
  posted,
  loading,
  onTogglePosted,
  onRegenerate,
  onUpdatePost,
}: {
  content: PlatformContent;
  posted: Record<string, boolean>;
  loading: boolean;
  onTogglePosted: (id: string) => void;
  onRegenerate: () => void;
  onUpdatePost: (platformId: string, idx: number, patch: Partial<PlatformPost>) => void;
}) {
  const pb = content.playbook;
  return (
    <div id={`ch-${content.platformId}`} className="scroll-mt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{content.platformName}</h3>
        <Button
          size="sm"
          variant="outline"
          className="no-print"
          disabled={loading}
          onClick={onRegenerate}
        >
          ↻ Regenerate
        </Button>
      </div>

      {pb && (pb.whyThisPlatform || pb.howToPost || pb.whatToAvoid) && (
        <Card className="mb-4 grid gap-3 bg-surface-2/40 p-4 text-xs sm:grid-cols-3">
          {pb.whyThisPlatform && (
            <PlaybookCell label="Why this platform" tone="accent">
              {pb.whyThisPlatform}
            </PlaybookCell>
          )}
          {pb.howToPost && (
            <PlaybookCell label="How to post">{pb.howToPost}</PlaybookCell>
          )}
          {pb.whatToAvoid && (
            <PlaybookCell label="What to avoid" tone="warn">
              {pb.whatToAvoid}
            </PlaybookCell>
          )}
        </Card>
      )}

      <div className="space-y-4">
        {content.posts.map((post, i) => {
          const id = `${content.platformId}-${i}`;
          return (
            <PostCard
              key={id}
              post={post}
              posted={!!posted[id]}
              onTogglePosted={() => onTogglePosted(id)}
              onUpdate={(patch) => onUpdatePost(content.platformId, i, patch)}
            />
          );
        })}
      </div>

      {pb && (pb.firstReplies.length > 0 || pb.postingWindow) && (
        <Card className="mt-4 bg-surface-2/40 p-4 text-xs">
          {pb.postingWindow && (
            <p className="text-neutral-400">
              <span className="text-neutral-500">⏰ Post during:</span>{" "}
              {pb.postingWindow}
            </p>
          )}
          {pb.firstReplies.length > 0 && (
            <div className={pb.postingWindow ? "mt-3" : ""}>
              <div className="mb-1.5 font-medium text-neutral-300">
                First replies to seed the thread
              </div>
              <ul className="space-y-1.5">
                {pb.firstReplies.map((r, i) => (
                  <li
                    key={i}
                    className="rounded-md bg-surface px-3 py-2 text-neutral-300"
                  >
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function PlaybookCell({
  label,
  tone = "default",
  children,
}: {
  label: string;
  tone?: "default" | "accent" | "warn";
  children: React.ReactNode;
}) {
  const labelColor =
    tone === "accent"
      ? "text-accent-300"
      : tone === "warn"
        ? "text-amber-300"
        : "text-neutral-500";
  return (
    <div>
      <div className={`mb-1 font-semibold uppercase tracking-wide ${labelColor}`}>
        {label}
      </div>
      <p className="text-neutral-300">{children}</p>
    </div>
  );
}

function PostCard({
  post,
  posted,
  onTogglePosted,
  onUpdate,
}: {
  post: PlatformPost;
  posted: boolean;
  onTogglePosted: () => void;
  onUpdate: (patch: Partial<PlatformPost>) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(`${post.hook}\n\n${post.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Unique candidate hooks: the current one plus any A/B variants.
  const candidates = useMemo(
    () => Array.from(new Set([post.hook, ...(post.hookVariants || [])])).filter(Boolean),
    [post.hook, post.hookVariants]
  );
  const switchHook = (c: string) =>
    onUpdate({ hook: c, hookVariants: candidates.filter((x) => x !== c) });

  return (
    <Card className={`p-5 ${posted ? "border-emerald-800 bg-emerald-950/20" : ""}`}>
      {editing ? (
        <div className="space-y-3">
          <Field label="Hook" value={post.hook} onChange={(v) => onUpdate({ hook: v })} />
          <Field label="Body" textarea value={post.body} onChange={(v) => onUpdate({ body: v })} />
          <Field
            label="Image suggestion"
            value={post.imageSuggestion}
            onChange={(v) => onUpdate({ imageSuggestion: v })}
          />
          <Field label="Caveats" value={post.caveats} onChange={(v) => onUpdate({ caveats: v })} />
        </div>
      ) : (
        <>
          <div className="mb-2 text-sm font-semibold text-accent-300">{post.hook}</div>
          {candidates.length > 1 && (
            <div className="no-print mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-neutral-500">A/B hooks:</span>
              {candidates.map((c, i) => (
                <button
                  key={i}
                  onClick={() => switchHook(c)}
                  className={`rounded-md px-2 py-1 text-xs transition-colors ${
                    c === post.hook
                      ? "bg-accent-600 text-white"
                      : "bg-surface-2 text-neutral-300 hover:text-white"
                  }`}
                >
                  {c.length > 42 ? c.slice(0, 42) + "…" : c}
                </button>
              ))}
            </div>
          )}
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-neutral-200">
            {post.body}
          </pre>
          <div className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-neutral-400">
            {post.imageSuggestion && <p>🖼️ {post.imageSuggestion}</p>}
            {post.bestTime && <p>⏰ Best time: {post.bestTime}</p>}
            {post.caveats && <p>⚠️ {post.caveats}</p>}
          </div>
        </>
      )}

      <div className="no-print mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={copy}>
          {copied ? "Copied!" : "Copy"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing((e) => !e)}>
          {editing ? "Done" : "Edit"}
        </Button>
        <Button
          size="sm"
          variant={posted ? "primary" : "outline"}
          onClick={onTogglePosted}
          className={posted ? "bg-emerald-700 hover:bg-emerald-600" : ""}
        >
          {posted ? "✓ Posted" : "Mark as posted"}
        </Button>
      </div>
    </Card>
  );
}
