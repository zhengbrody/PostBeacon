"use client";

import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Tabs, type TabDef } from "@/components/ui/Tabs";
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
import {
  toMarkdown,
  toJson,
  postsToMarkdown,
  downloadFile,
  type ExportSnapshot,
} from "@/lib/export";
import type {
  GenerateResult,
  MarketingStrategy,
  PlatformContent,
  PlatformPost,
  PlatformRecommendation,
  ProductProfile,
  ScheduleItem,
} from "@/lib/types";

type TabId = "overview" | "content" | "calendar" | "execute";

export function ResultsView({
  result,
  strategy,
  profile,
  posted,
  onTogglePosted,
  onRegenerate,
  onUpdatePost,
  onUpdateStrategy,
  onUpdateRecommendation,
  onUpdateScheduleItem,
  onRemoveScheduleItem,
  onAddScheduleItem,
  onRemoveChannel,
  onAddChannel,
  launchDate,
  setLaunchDate,
  loading,
  demo,
  onReset,
}: {
  result: GenerateResult;
  strategy: MarketingStrategy | null;
  profile: ProductProfile | null;
  posted: Record<string, boolean>;
  onTogglePosted: (id: string) => void;
  onRegenerate: (platformId: string) => void;
  onUpdatePost: (platformId: string, idx: number, patch: Partial<PlatformPost>) => void;
  onUpdateStrategy: (patch: Partial<MarketingStrategy>) => void;
  onUpdateRecommendation: (
    platformId: string,
    patch: Partial<PlatformRecommendation>
  ) => void;
  onUpdateScheduleItem: (idx: number, patch: Partial<ScheduleItem>) => void;
  onRemoveScheduleItem: (idx: number) => void;
  onAddScheduleItem: (item: ScheduleItem) => void;
  onRemoveChannel: (platformId: string) => void;
  onAddChannel: (platformId: string) => void;
  launchDate: string;
  setLaunchDate: (v: string) => void;
  loading: boolean;
  demo: boolean;
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

  // Channels in their ranked order (generate returns catalog order).
  const orderedContent = useMemo(() => {
    if (!strategy) return result.content;
    const rank = new Map(
      strategy.recommendations.map((r, i) => [r.platformId, i])
    );
    return [...result.content].sort(
      (a, b) =>
        (rank.get(a.platformId) ?? Infinity) - (rank.get(b.platformId) ?? Infinity)
    );
  }, [strategy, result.content]);

  const hasExecute = !!(
    strategy?.founderChecklist?.length ||
    strategy?.risks?.length ||
    strategy?.iterationLoop?.length
  );

  const tabs: TabDef[] = [
    ...(strategy ? [{ id: "overview", label: "Overview" }] : []),
    { id: "content", label: "Content", count: result.content.length },
    { id: "calendar", label: "Calendar", count: result.schedule.length },
    ...(hasExecute ? [{ id: "execute", label: "Execute" }] : []),
  ];
  const [tab, setTab] = useState<TabId>(strategy ? "overview" : "content");

  // Print / Cmd+P: force-mount every tab body so the PDF is the full plan.
  // flushSync makes React commit before the browser snapshots the page.
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  const show = (id: TabId) => printing || tab === id;

  return (
    <div className="space-y-6">
      <Tabs tabs={tabs} active={tab} onSelect={(id) => setTab(id as TabId)} />

      {strategy && show("overview") && (
        <section className="space-y-6">
          {printing && <PrintHeading>Overview</PrintHeading>}
          <PositioningCard strategy={strategy} onUpdate={onUpdateStrategy} />
          {strategy.audienceSegments && strategy.audienceSegments.length > 0 && (
            <AudienceCard segments={strategy.audienceSegments} />
          )}
          {strategy.phases && strategy.phases.length > 0 && (
            <LaunchPlanCard phases={strategy.phases} />
          )}
        </section>
      )}

      {show("content") && (
        <ContentTab
          orderedContent={orderedContent}
          result={result}
          strategy={strategy}
          posted={posted}
          loading={loading}
          demo={demo}
          printing={printing}
          onTogglePosted={onTogglePosted}
          onRegenerate={onRegenerate}
          onUpdatePost={onUpdatePost}
          onUpdateRecommendation={onUpdateRecommendation}
          onRemoveChannel={onRemoveChannel}
          onAddChannel={onAddChannel}
        />
      )}

      {show("calendar") && (
        <section>
          {printing && <PrintHeading>Calendar</PrintHeading>}
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
              {result.schedule.map((s, i) => (
                <CalendarRow
                  key={`${s.day}-${s.action}-${i}`}
                  item={s}
                  date={scheduleDate(launchDate, s.day)}
                  onCommit={(patch) => onUpdateScheduleItem(i, patch)}
                  onDelete={() => onRemoveScheduleItem(i)}
                />
              ))}
            </ol>
            <AddStepRow onAdd={onAddScheduleItem} />
          </Card>
        </section>
      )}

      {hasExecute && show("execute") && strategy && (
        <section className="space-y-6">
          {printing && <PrintHeading>Execute</PrintHeading>}
          {strategy.founderChecklist && strategy.founderChecklist.length > 0 && (
            <FounderChecklistCard tasks={strategy.founderChecklist} />
          )}
          {strategy.risks && strategy.risks.length > 0 && (
            <RisksCard risks={strategy.risks} />
          )}
          {strategy.iterationLoop && strategy.iterationLoop.length > 0 && (
            <IterationCard metrics={strategy.iterationLoop} />
          )}
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

function PrintHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-4 text-xl font-bold">{children}</h2>;
}

/** Master-detail content library: pick a channel on the left, work its posts
 *  and playbook on the right. Printing lays every channel out in full. */
function ContentTab({
  orderedContent,
  result,
  strategy,
  posted,
  loading,
  demo,
  printing,
  onTogglePosted,
  onRegenerate,
  onUpdatePost,
  onUpdateRecommendation,
  onRemoveChannel,
  onAddChannel,
}: {
  orderedContent: PlatformContent[];
  result: GenerateResult;
  strategy: MarketingStrategy | null;
  posted: Record<string, boolean>;
  loading: boolean;
  demo: boolean;
  printing: boolean;
  onTogglePosted: (id: string) => void;
  onRegenerate: (platformId: string) => void;
  onUpdatePost: (platformId: string, idx: number, patch: Partial<PlatformPost>) => void;
  onUpdateRecommendation: (
    platformId: string,
    patch: Partial<PlatformRecommendation>
  ) => void;
  onRemoveChannel: (platformId: string) => void;
  onAddChannel: (platformId: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addPick, setAddPick] = useState("");
  const [copiedAll, setCopiedAll] = useState(false);

  // Self-heals when the active channel is removed.
  const current =
    orderedContent.find((c) => c.platformId === activeId) ?? orderedContent[0];

  const recFor = (platformId: string) =>
    strategy?.recommendations.find((r) => r.platformId === platformId);

  // Ranked channels we haven't written content for yet.
  const addable = (strategy?.recommendations ?? []).filter(
    (r) => !result.content.some((c) => c.platformId === r.platformId)
  );

  async function copyAllPosts() {
    await navigator.clipboard.writeText(postsToMarkdown(result));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  }

  const channelBlock = (c: PlatformContent) => (
    <ChannelBlock
      key={c.platformId}
      content={c}
      rec={recFor(c.platformId)}
      posted={posted}
      loading={loading}
      removable={orderedContent.length > 1}
      onTogglePosted={onTogglePosted}
      onRegenerate={() => onRegenerate(c.platformId)}
      onUpdatePost={onUpdatePost}
      onUpdateRec={(patch) => onUpdateRecommendation(c.platformId, patch)}
      onRemove={() => onRemoveChannel(c.platformId)}
    />
  );

  return (
    <section>
      {printing && <PrintHeading>Content</PrintHeading>}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-accent-300">
          Content library
        </h2>
        <Button size="sm" variant="outline" className="no-print" onClick={copyAllPosts}>
          {copiedAll ? "Copied!" : "⧉ Copy all posts"}
        </Button>
      </div>

      {/* print:block — with the aside hidden on paper, the grid column would
          otherwise squeeze the content into the 16rem sidebar track */}
      <div className="gap-6 print:block md:grid md:grid-cols-[16rem_minmax(0,1fr)] md:items-start">
        <aside className="no-print mb-6 md:sticky md:top-4 md:mb-0">
          <div className="space-y-1.5">
            {orderedContent.map((c) => {
              const rec = recFor(c.platformId);
              const done = c.posts.filter(
                (_, i) => posted[`${c.platformId}-${i}`]
              ).length;
              const on = c.platformId === current?.platformId;
              return (
                <button
                  key={c.platformId}
                  onClick={() => setActiveId(c.platformId)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    on
                      ? "border-accent-500 bg-accent-600/10"
                      : "border-line bg-surface-2 hover:border-neutral-600"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">
                      {c.platformName}
                    </span>
                    {rec && (
                      <span className="font-mono text-xs text-neutral-500">
                        {rec.score}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
                    {rec && <PriorityBadge priority={rec.priority} />}
                    <span className={done === c.posts.length ? "text-emerald-400" : ""}>
                      {done}/{c.posts.length} posted
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {!demo && addable.length > 0 && (
            <div className="mt-4 space-y-2 rounded-lg border border-dashed border-line p-3">
              <label className="block text-xs text-neutral-500">
                Need another channel?
              </label>
              <select
                value={addPick}
                onChange={(e) => setAddPick(e.target.value)}
                className="w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-accent-500"
              >
                <option value="">Pick a channel…</option>
                {addable.map((r) => (
                  <option key={r.platformId} value={r.platformId}>
                    {r.platformName} · {r.score}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                className="w-full"
                disabled={!addPick || loading}
                onClick={() => {
                  onAddChannel(addPick);
                  setAddPick("");
                }}
              >
                ＋ Write content for it
              </Button>
            </div>
          )}
        </aside>

        <div className="space-y-10">
          {printing ? (
            orderedContent.map(channelBlock)
          ) : current ? (
            channelBlock(current)
          ) : (
            <p className="text-sm text-neutral-500">
              No channels left — add one from the list to keep going.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function ChannelBlock({
  content,
  rec,
  posted,
  loading,
  removable,
  onTogglePosted,
  onRegenerate,
  onUpdatePost,
  onUpdateRec,
  onRemove,
}: {
  content: PlatformContent;
  rec?: PlatformRecommendation;
  posted: Record<string, boolean>;
  loading: boolean;
  removable: boolean;
  onTogglePosted: (id: string) => void;
  onRegenerate: () => void;
  onUpdatePost: (platformId: string, idx: number, patch: Partial<PlatformPost>) => void;
  onUpdateRec: (patch: Partial<PlatformRecommendation>) => void;
  onRemove: () => void;
}) {
  const pb = content.playbook;
  const [editingRec, setEditingRec] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    if (!confirmRemove) return;
    const t = setTimeout(() => setConfirmRemove(false), 3000);
    return () => clearTimeout(t);
  }, [confirmRemove]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{content.platformName}</h3>
        <span className="no-print flex gap-2">
          <Button size="sm" variant="outline" disabled={loading} onClick={onRegenerate}>
            ↻ Regenerate
          </Button>
          {removable && (
            <Button
              size="sm"
              variant="outline"
              className={confirmRemove ? "border-red-700 text-red-300" : ""}
              onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
            >
              {confirmRemove ? "Confirm remove?" : "Remove"}
            </Button>
          )}
        </span>
      </div>

      {rec && (
        <Card className="mb-4 bg-surface-2/40 p-4 text-xs">
          {editingRec ? (
            <div className="space-y-3">
              <Field
                label="Angle"
                textarea
                value={rec.angle}
                onChange={(v) => onUpdateRec({ angle: v })}
              />
              <Field
                label="Best move"
                textarea
                value={rec.bestMove ?? ""}
                onChange={(v) => onUpdateRec({ bestMove: v })}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-accent-300">
                <span className="text-neutral-500">Angle:</span> {rec.angle}
              </p>
              {rec.bestMove && (
                <p className="text-neutral-300">
                  <span className="text-neutral-500">Best move:</span> {rec.bestMove}
                </p>
              )}
            </div>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="no-print mt-2"
            onClick={() => setEditingRec((e) => !e)}
          >
            {editingRec ? "Done" : "✎ Edit angle"}
          </Button>
        </Card>
      )}

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

/** One calendar step. Edits are drafted locally and committed on Done, so the
 *  by-day re-sort never yanks the row out from under the cursor. */
function CalendarRow({
  item,
  date,
  onCommit,
  onDelete,
}: {
  item: ScheduleItem;
  date: string;
  onCommit: (patch: Partial<ScheduleItem>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [day, setDay] = useState(String(item.day));
  const [action, setAction] = useState(item.action);

  const commit = () => {
    onCommit({
      day: Math.max(1, Number(day) || item.day),
      action: action.trim() || item.action,
    });
    setEditing(false);
  };

  return (
    <li className="relative">
      <span className="absolute -left-[1.42rem] top-2 h-2 w-2 rounded-full bg-accent-500" />
      {editing ? (
        <div className="flex flex-wrap items-end gap-3 rounded-lg bg-surface-2 px-4 py-2.5">
          <label className="text-xs text-neutral-400">
            Day
            <input
              type="number"
              min={1}
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="mt-1 block w-16 rounded-md border border-line bg-surface px-2 py-1 text-xs text-neutral-100 outline-none focus:border-accent-500"
            />
          </label>
          <Field label="Action" value={action} onChange={setAction} className="min-w-0 flex-1" />
          <Button size="sm" onClick={commit}>
            Done
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-4 py-2.5 text-sm">
          <span className="shrink-0 rounded-md bg-accent-700/40 px-2 py-1 text-xs font-medium text-accent-200">
            Day {item.day}
            {date && <span className="ml-1 text-accent-300/80">· {date}</span>}
          </span>
          <span className="min-w-0 flex-1 text-neutral-300">{item.action}</span>
          <span className="no-print flex shrink-0 gap-1 text-xs">
            <button
              onClick={() => {
                setDay(String(item.day));
                setAction(item.action);
                setEditing(true);
              }}
              className="text-neutral-500 hover:text-neutral-200"
            >
              ✎
            </button>
            <button onClick={onDelete} className="text-neutral-600 hover:text-red-400">
              ×
            </button>
          </span>
        </div>
      )}
    </li>
  );
}

function AddStepRow({ onAdd }: { onAdd: (item: ScheduleItem) => void }) {
  const [day, setDay] = useState("1");
  const [action, setAction] = useState("");
  return (
    <div className="no-print mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
      <label className="text-xs text-neutral-400">
        Day
        <input
          type="number"
          min={1}
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="mt-1 block w-16 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-accent-500"
        />
      </label>
      <Field
        label="Add your own step"
        value={action}
        onChange={setAction}
        placeholder="e.g. Email 10 beta users for feedback"
        className="min-w-0 flex-1"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!action.trim()}
        onClick={() => {
          onAdd({
            day: Math.max(1, Number(day) || 1),
            platformId: "custom",
            platformName: "Custom",
            action: action.trim(),
          });
          setAction("");
        }}
      >
        ＋ Add step
      </Button>
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
