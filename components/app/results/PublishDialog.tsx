"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ExecutionProgress } from "./ExecutionProgress";
import { DraftSafetyNotice } from "./DraftSafetyNotice";
import { auditDraftSafety } from "@/lib/contentSafety";
import { normalizeTrackedUrl } from "@/lib/trackedUrl";
import { trialPublicationIssues } from "@/lib/opportunityResearch";
import { projectExperimentContract } from "@/lib/experimentContract";
import {
  TESTED_VARIABLES,
  VARIABLE_LABELS,
  comparisonBoundary,
} from "@/lib/experimentQueue";
import type { ExecutionStep } from "@/lib/execution";
import type {
  Fact,
  PlatformContent,
  PlatformRecommendation,
  ProductProfile,
  SuccessContract,
  TestedVariable,
  Experiment,
  TrialOpportunitySnapshot,
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
  variable: TestedVariable;
  heldConstant: string;
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
  successContract,
  defaultPostIdx,
  initialCommunity,
  initialAngle,
  initialVariable,
  heldConstant,
  sourceExperiment,
  trial,
  bannedClaims = [],
  lockedDraft = false,
  publishedPostIndices = [],
  demo = false,
  onConfirm,
  onClose,
}: {
  content: PlatformContent;
  facts: Fact[];
  profile: ProductProfile;
  rec?: PlatformRecommendation;
  successContract?: SuccessContract;
  defaultPostIdx: number;
  /** Optional prefills (e.g. from a confirmed create_experiment proposal). */
  initialCommunity?: string;
  initialAngle?: string;
  initialVariable?: TestedVariable;
  heldConstant?: string;
  sourceExperiment?: Experiment;
  trial?: TrialOpportunitySnapshot;
  bannedClaims?: string[];
  lockedDraft?: boolean;
  publishedPostIndices?: number[];
  demo?: boolean;
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
  const [variable, setVariable] = useState<TestedVariable>(
    initialVariable ?? "exploratory"
  );
  const normalizedTrackedUrl = normalizeTrackedUrl(trackedUrl);
  const trackedUrlInvalid = trackedUrl.trim() !== "" && !normalizedTrackedUrl;
  const selectedPost = content.posts[postIdx];
  const comparison =
    sourceExperiment && selectedPost
      ? comparisonBoundary(
          sourceExperiment,
          {
            audience: profile.audience,
            publisherVoice: profile.publisherVoice ?? "brand",
            facts,
            draft: selectedPost,
            variable,
            heldConstant: heldConstant ?? "",
            successContract,
          },
          community.trim(),
          angle.trim()
        )
      : {
          variable,
          heldConstant: "Intended variable only; no controlled comparison claimed.",
        };
  const safety = selectedPost
    ? auditDraftSafety(selectedPost, facts, profile, content.platformId)
    : { ready: false, issues: [] };
  const trialIssues =
    trial && selectedPost ? trialPublicationIssues(trial, selectedPost, bannedClaims) : [];
  const experimentContract = selectedPost
    ? projectExperimentContract({
        profile: trial ? { ...profile, audience: trial.audience } : profile,
        recommendation: rec
          ? {
              ...rec,
              venue: community.trim() || rec.venue,
              angle: angle.trim() || rec.angle,
            }
          : undefined,
        content,
        post: selectedPost,
        successContract,
        variable: comparison.variable,
      })
    : undefined;

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-label="Confirm manual publish"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">
          {demo
            ? `Simulate a manual ${content.platformName} publish`
            : `Published on ${content.platformName} — start tracking it`}
        </h2>
        <p className="mb-4 mt-1 text-xs text-neutral-500">
          {demo
            ? "This is fictional example data. Nothing is posted, sent to a model, or saved."
            : "This creates an experiment so the 24h and 72h check-ins know what to ask about. PostBeacon never posts for you."}
        </p>
        <div className="mb-5 rounded-lg border border-line bg-surface-2/50 p-3">
          <ExecutionProgress steps={PUBLISH_STEPS} />
          <p className="mt-3 text-xs text-neutral-500">
            {demo
              ? "Try the same confirmation a real project uses. It updates only this temporary example workspace."
              : "Confirm what you actually published. This click starts the 24h countdown and updates Today, Progress and Weekly Review together."}
          </p>
        </div>

        {experimentContract && (
          <div className="mb-4 rounded-lg border border-accent-700/40 bg-accent-600/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-accent-300">
                Experiment contract
              </div>
              <span className="rounded-full bg-surface-2 px-2 py-1 text-[10px] text-neutral-400">
                Snapshot on publish
              </span>
            </div>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-neutral-500">Audience / venue</dt>
                <dd className="mt-0.5 text-neutral-200">
                  {experimentContract.audience} · {experimentContract.venue}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">Variable</dt>
                <dd className="mt-0.5 text-neutral-200">
                  {experimentContract.variable} · {experimentContract.candidate}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">Angle</dt>
                <dd className="mt-0.5 text-neutral-200">{experimentContract.angle}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Success rule</dt>
                <dd className="mt-0.5 text-neutral-200">
                  {experimentContract.decisionRule}
                </dd>
              </div>
            </dl>
            <p className="mt-1 text-[11px] text-neutral-500">
              The full draft, audience, publishing voice, product facts and Success Contract
              are saved as this execution&apos;s snapshot. No causal conclusion is implied.
            </p>
          </div>
        )}

        {content.posts.length > 1 && (
          <label className="mb-3 block text-xs text-neutral-400">
            Which draft did you post?
            <select
              disabled={lockedDraft || Boolean(sourceExperiment)}
              value={postIdx}
              onChange={(e) => setPostIdx(Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent-500"
            >
              {content.posts.map((p, i) => (
                <option key={i} value={i} disabled={publishedPostIndices.includes(i)}>
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
        {trialIssues.length > 0 && (
          <p role="alert" className="mb-4 text-sm text-amber-300">
            Trial publish blocked: {trialIssues.join("; ")}. Restore the reviewed entry and
            remove banned claims, or prepare a new trial.
          </p>
        )}

        {trial && (
          <div className="mb-4 rounded-lg border border-line p-3 text-xs text-neutral-300">
            <p className="font-semibold">Product trial provenance · exploratory</p>
            <p className="mt-2">Trial audience: {trial.audience}</p>
            <p className="mt-2 break-all">
              Demand source: {trial.source.url} · {trial.source.verification}. This is not
              the publishing venue.
            </p>
            <p className="mt-2">
              Venue rules: user checked at {trial.rulesUserCheckedAt}; not independently
              reviewed.
            </p>
            <ol className="ml-5 mt-2 list-decimal space-y-1">
              {trial.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
            <p className="mt-2">Ask: {trial.feedbackQuestion}</p>
            <p className="mt-2">
              Recording a publish is your report; it does not prove anyone tried the
              product. Product activation is still unmeasured.
            </p>
          </div>
        )}

        <div className="space-y-3">
          <label className="block text-xs text-neutral-400">
            What variable are you testing?
            <select
              disabled={Boolean(initialVariable)}
              value={variable}
              onChange={(event) => setVariable(event.target.value as TestedVariable)}
              className="mt-1 min-h-11 w-full rounded-md border border-line bg-surface-2 px-2"
            >
              {TESTED_VARIABLES.map((item) => (
                <option key={item} value={item}>
                  {VARIABLE_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-neutral-500">{comparison.heldConstant}</p>
          {selectedPost && (
            <details>
              <summary className="min-h-11 cursor-pointer text-xs text-neutral-400">
                Review the exact published draft snapshot
              </summary>
              <p className="whitespace-pre-wrap break-words text-sm">{selectedPost.hook}</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                {selectedPost.body}
              </p>
            </details>
          )}
          {!trial ? (
            <Field
              label="Community / venue (where exactly)"
              value={community}
              onChange={setCommunity}
              placeholder="e.g. r/selfhosted"
            />
          ) : (
            <p className="text-xs text-neutral-400">
              Approved publishing venue: {community}. To change it, prepare and review a new
              trial.
            </p>
          )}
          {!trial ? (
            <Field label="Angle you led with" value={angle} onChange={setAngle} />
          ) : (
            <p className="text-xs text-neutral-400">Trial task: {angle}</p>
          )}
          <Field
            label="Link to the live post (optional)"
            value={trackedUrl}
            onChange={setTrackedUrl}
            placeholder="https://…"
          />
          {trackedUrlInvalid && (
            <p className="text-xs text-red-300" role="alert">
              Use a complete http:// or https:// URL. Relative and non-web links cannot be
              tracked.
            </p>
          )}
        </div>

        <div className="mt-5 flex gap-2">
          {publishedPostIndices.includes(postIdx) && (
            <p className="text-xs text-amber-300" role="status">
              This draft is already tracked. Prepare a new follow-up draft instead of
              creating a duplicate execution.
            </p>
          )}
          <Button
            disabled={
              !safety.ready ||
              trialIssues.length > 0 ||
              trackedUrlInvalid ||
              publishedPostIndices.includes(postIdx)
            }
            title={!safety.ready ? "Fix the truth-check issues before tracking" : undefined}
            onClick={() =>
              onConfirm({
                community: community.trim(),
                angle: angle.trim(),
                postIdx,
                variant: content.posts[postIdx]?.hook ?? "",
                trackedUrl: normalizedTrackedUrl ?? "",
                variable: comparison.variable,
                heldConstant: comparison.heldConstant,
              })
            }
          >
            {demo ? "Simulate publish" : "Start tracking"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
