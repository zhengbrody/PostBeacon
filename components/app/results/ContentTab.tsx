"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PriorityBadge } from "@/components/ui/Badge";
import { postsToMarkdown } from "@/lib/export";
import { unsafeDraftCount } from "@/lib/contentSafety";
import { PrintHeading } from "./PrintHeading";
import { ChannelBlock } from "./ChannelBlock";
import type {
  GenerateResult,
  Fact,
  MarketingStrategy,
  PlatformContent,
  PlatformPost,
  PlatformRecommendation,
  ProductProfile,
} from "@/lib/types";

/** Master-detail content library: pick a channel on the left, work its posts
 *  and playbook on the right. Printing lays every channel out in full. */
export function ContentTab({
  orderedContent,
  result,
  strategy,
  facts,
  profile,
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
  onRequestPublish,
}: {
  orderedContent: PlatformContent[];
  result: GenerateResult;
  strategy: MarketingStrategy | null;
  facts: Fact[];
  profile: ProductProfile;
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
  onRequestPublish: (platformId: string, postIdx: number) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addPick, setAddPick] = useState("");
  const [copiedAll, setCopiedAll] = useState(false);
  const unsafeCount = useMemo(
    () =>
      result.content.reduce(
        (count, item) =>
          count + unsafeDraftCount(item.posts, facts, profile, item.platformId),
        0
      ),
    [result.content, facts, profile]
  );

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
    if (unsafeCount > 0) return;
    await navigator.clipboard.writeText(postsToMarkdown(result));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  }

  const channelBlock = (c: PlatformContent) => (
    <ChannelBlock
      key={c.platformId}
      content={c}
      facts={facts}
      profile={profile}
      rec={recFor(c.platformId)}
      posted={posted}
      loading={loading}
      removable={orderedContent.length > 1}
      onTogglePosted={onTogglePosted}
      onRegenerate={() => onRegenerate(c.platformId)}
      onUpdatePost={onUpdatePost}
      onUpdateRec={(patch) => onUpdateRecommendation(c.platformId, patch)}
      onRemove={() => onRemoveChannel(c.platformId)}
      onRequestPublish={(postIdx) => onRequestPublish(c.platformId, postIdx)}
    />
  );

  return (
    <section>
      {printing && <PrintHeading>Content</PrintHeading>}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-accent-300">
          Content library
        </h2>
        <Button
          size="sm"
          variant="outline"
          className="no-print"
          disabled={unsafeCount > 0}
          title={
            unsafeCount > 0
              ? `Fix ${unsafeCount} draft${unsafeCount === 1 ? "" : "s"} before copying all`
              : undefined
          }
          onClick={copyAllPosts}
        >
          {copiedAll ? "Copied!" : "⧉ Copy all posts"}
        </Button>
      </div>

      {unsafeCount > 0 && (
        <div className="no-print mb-4 rounded-lg border border-amber-800/70 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          {unsafeCount} generated {unsafeCount === 1 ? "draft needs" : "drafts need"} a
          truth fix. Open each flagged draft to edit or regenerate it; bulk copy stays
          locked until all pass.
        </div>
      )}

      {/* print:block — with the aside hidden on paper, the grid column would
          otherwise squeeze the content into the 16rem sidebar track */}
      <div className="gap-6 print:block md:grid md:grid-cols-[16rem_minmax(0,1fr)] md:items-start">
        <aside className="no-print mb-6 md:sticky md:top-4 md:mb-0">
          <div className="space-y-1.5">
            {orderedContent.map((c) => {
              const rec = recFor(c.platformId);
              const done = c.posts.filter((_, i) => posted[`${c.platformId}-${i}`]).length;
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
