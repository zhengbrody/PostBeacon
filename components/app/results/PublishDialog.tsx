"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ExecutionProgress } from "./ExecutionProgress";
import { DraftSafetyNotice } from "./DraftSafetyNotice";
import { auditDraftSafety } from "@/lib/contentSafety";
import type { ExecutionStep } from "@/lib/execution";
import type {
  Fact,
  PlatformContent,
  PlatformRecommendation,
  ProductProfile,
} from "@/lib/types";

const PUBLISH_STEPS: ExecutionStep[] = [
  { id: "prepare", label: "Prepare", done: true, active: false },
  { id: "publish", label: "Publish", done: false, active: true },
  { id: "measure", label: "Measure", done: false, active: false },
  { id: "learn", label: "Learn", done: false, active: false },
];

export interface PublishDetails {
  community: string;
  angle: string;
  postIdx: number;
  variant: string; // the hook actually used
  trackedUrl: string;
}

/**
 * "I published it" → one lightweight confirmation that starts the experiment.
 * Everything is prefilled from the plan; nothing is posted anywhere by us.
 */
export function PublishDialog({
  content,
  facts,
  profile,
  rec,
  defaultPostIdx,
  initialCommunity,
  initialAngle,
  onConfirm,
  onClose,
}: {
  content: PlatformContent;
  facts: Fact[];
  profile: ProductProfile;
  rec?: PlatformRecommendation;
  defaultPostIdx: number;
  /** Optional prefills (e.g. from a confirmed create_experiment proposal). */
  initialCommunity?: string;
  initialAngle?: string;
  onConfirm: (details: PublishDetails) => void;
  onClose: () => void;
}) {
  const [community, setCommunity] = useState(
    initialCommunity ?? rec?.venue ?? rec?.bestMove ?? ""
  );
  const [angle, setAngle] = useState(initialAngle ?? rec?.angle ?? "");
  const [postIdx, setPostIdx] = useState(
    Math.min(defaultPostIdx, Math.max(0, content.posts.length - 1))
  );
  const [trackedUrl, setTrackedUrl] = useState("");
  const selectedPost = content.posts[postIdx];
  const safety = selectedPost
    ? auditDraftSafety(selectedPost, facts, profile)
    : { ready: false, issues: [] };

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <Card
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">
          Published on {content.platformName} — start tracking it
        </h2>
        <p className="mb-4 mt-1 text-xs text-neutral-500">
          This creates an experiment so the 24h and 72h check-ins know what to ask about.
          PostBeacon never posts for you.
        </p>
        <div className="mb-5 rounded-lg border border-line bg-surface-2/50 p-3">
          <ExecutionProgress steps={PUBLISH_STEPS} />
          <p className="mt-3 text-xs text-neutral-500">
            Confirm what you actually published. This click starts the 24h countdown and
            updates Today, Progress and Weekly Review together.
          </p>
        </div>

        {content.posts.length > 1 && (
          <label className="mb-3 block text-xs text-neutral-400">
            Which draft did you post?
            <select
              value={postIdx}
              onChange={(e) => setPostIdx(Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent-500"
            >
              {content.posts.map((p, i) => (
                <option key={i} value={i}>
                  {p.hook.length > 60 ? p.hook.slice(0, 60) + "…" : p.hook}
                </option>
              ))}
            </select>
          </label>
        )}

        {selectedPost && (
          <div className="mb-4">
            <DraftSafetyNotice report={safety} />
          </div>
        )}

        <div className="space-y-3">
          <Field
            label="Community / venue (where exactly)"
            value={community}
            onChange={setCommunity}
            placeholder="e.g. r/selfhosted"
          />
          <Field label="Angle you led with" value={angle} onChange={setAngle} />
          <Field
            label="Link to the live post (optional)"
            value={trackedUrl}
            onChange={setTrackedUrl}
            placeholder="https://…"
          />
        </div>

        <div className="mt-5 flex gap-2">
          <Button
            disabled={!safety.ready}
            title={!safety.ready ? "Fix the truth-check issues before tracking" : undefined}
            onClick={() =>
              onConfirm({
                community: community.trim(),
                angle: angle.trim(),
                postIdx,
                variant: content.posts[postIdx]?.hook ?? "",
                trackedUrl: trackedUrl.trim(),
              })
            }
          >
            Start tracking
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
