"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { PostCard } from "./PostCard";
import { platformSupportsThreadReplies } from "@/lib/platforms";
import type {
  Fact,
  PlatformContent,
  PlatformPost,
  PlatformRecommendation,
  ProductProfile,
} from "@/lib/types";

/** One channel's working area: header (meta + regenerate/remove), editable
 *  angle/best-move, playbook, posts, seed replies. */
export function ChannelBlock({
  content,
  facts,
  profile,
  rec,
  posted,
  loading,
  removable,
  onTogglePosted,
  onRegenerate,
  onUpdatePost,
  onUpdateRec,
  onRemove,
  onRequestPublish,
}: {
  content: PlatformContent;
  facts: Fact[];
  profile: ProductProfile;
  rec?: PlatformRecommendation;
  posted: Record<string, boolean>;
  loading: boolean;
  removable: boolean;
  onTogglePosted: (id: string) => void;
  onRegenerate: () => void;
  onUpdatePost: (platformId: string, idx: number, patch: Partial<PlatformPost>) => void;
  onUpdateRec: (patch: Partial<PlatformRecommendation>) => void;
  onRemove: () => void;
  onRequestPublish: (postIdx: number) => void;
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
        <div>
          <h3 className="text-lg font-semibold">{content.platformName}</h3>
          {content.meta && (
            <p
              className="text-[10px] text-neutral-600"
              title="Which model wrote this draft, with which prompt version, when"
            >
              {content.meta.provider} · {content.meta.model} · prompt{" "}
              {content.meta.promptVersion} ·{" "}
              {content.meta.generatedAt.slice(0, 16).replace("T", " ")}
            </p>
          )}
        </div>
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
          {pb.howToPost && <PlaybookCell label="How to post">{pb.howToPost}</PlaybookCell>}
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
              platformId={content.platformId}
              facts={facts}
              profile={profile}
              posted={!!posted[id]}
              onTogglePosted={() => onTogglePosted(id)}
              onPublish={() => onRequestPublish(i)}
              onUpdate={(patch) => onUpdatePost(content.platformId, i, patch)}
            />
          );
        })}
      </div>

      {pb &&
        (pb.postingWindow ||
          (platformSupportsThreadReplies(content.platformId) &&
            pb.firstReplies.length > 0)) && (
          <Card className="mt-4 bg-surface-2/40 p-4 text-xs">
            {pb.postingWindow && (
              <p className="text-neutral-400">
                <span className="text-neutral-500">⏰ Post during:</span> {pb.postingWindow}
              </p>
            )}
            {platformSupportsThreadReplies(content.platformId) &&
              pb.firstReplies.length > 0 && (
                <div className={pb.postingWindow ? "mt-3" : ""}>
                  <div className="mb-1.5 font-medium text-neutral-300">
                    Conversation starters for real replies
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
