"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  buildShareKit,
  explainDraft,
  projectExperimentContract,
} from "@/lib/experimentContract";
import type {
  Fact,
  PlatformContent,
  PlatformPost,
  PlatformRecommendation,
  ProductProfile,
  SuccessContract,
} from "@/lib/types";

export function DraftDecisionSupport({
  content,
  facts,
  post,
  profile,
  recommendation,
  successContract,
  hookChange,
}: {
  content: PlatformContent;
  facts: Fact[];
  post: PlatformPost;
  profile: ProductProfile;
  recommendation?: PlatformRecommendation;
  successContract?: SuccessContract;
  hookChange?: { from: string; to: string };
}) {
  const [copyStatus, setCopyStatus] = useState<"x" | "linkedin" | "failed" | null>(null);
  const contract = projectExperimentContract({
    profile,
    recommendation,
    content,
    post,
    successContract,
  });
  const rationale = explainDraft({ facts, recommendation, content });
  const shareKit = buildShareKit({
    profile,
    recommendation,
    content,
    post,
    successContract,
  });

  async function copy(label: "x" | "linkedin", value: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setCopyStatus(label);
    } catch {
      setCopyStatus("failed");
    }
    window.setTimeout(() => setCopyStatus(null), 1500);
  }

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-accent-700/50 bg-accent-950/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h5 className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-300">
            Experiment contract
          </h5>
          <span className="rounded-full bg-surface-2 px-2 py-1 text-[10px] text-neutral-400">
            One variable · Hook
          </span>
        </div>
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-neutral-500">Audience / venue</dt>
            <dd className="mt-0.5 text-neutral-200">
              {contract.audience} · {contract.venue}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">What this run tests</dt>
            <dd className="mt-0.5 text-neutral-200">Hook · {contract.candidate}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Angle held constant</dt>
            <dd className="mt-0.5 text-neutral-200">{contract.angle}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Success rule</dt>
            <dd className="mt-0.5 text-neutral-200">{contract.decisionRule}</dd>
          </div>
        </dl>
      </section>

      {hookChange && (
        <div
          className="rounded-lg border border-emerald-900/70 bg-emerald-950/20 px-3 py-2.5 text-xs"
          role="status"
          aria-live="polite"
        >
          <div className="font-semibold text-emerald-300">Variable changed · Hook</div>
          <div className="mt-1 text-neutral-500 line-through">{hookChange.from}</div>
          <div className="mt-1 text-neutral-200">→ {hookChange.to}</div>
        </div>
      )}

      <details className="group rounded-xl border border-line bg-surface/35">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-neutral-300">
          <span className="flex items-center justify-between gap-3">
            Why this draft
            <span className="text-neutral-600 transition-transform group-open:rotate-180">
              ⌄
            </span>
          </span>
        </summary>
        <div className="space-y-3 border-t border-line px-4 py-4 text-xs">
          <div>
            <div className="font-medium text-neutral-300">Strategy evidence</div>
            {rationale.evidence.length ? (
              <ul className="mt-1.5 space-y-1.5 text-neutral-400">
                {rationale.evidence.map((fact) => (
                  <li key={fact.id}>
                    <span className="text-neutral-200">{fact.claim}</span>{" "}
                    <span className="text-neutral-600">· {fact.status}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-neutral-500">
                This legacy recommendation has no fact references attached; the Truth Gate
                still checks the final copy.
              </p>
            )}
          </div>
          <div>
            <div className="font-medium text-neutral-300">Platform rule</div>
            <p className="mt-1 leading-relaxed text-neutral-400">
              {rationale.platformRule}
            </p>
          </div>
          <div>
            <div className="font-medium text-neutral-300">Selected angle</div>
            <p className="mt-1 text-neutral-400">{rationale.angle}</p>
          </div>
          {rationale.inferenceNotes.length > 0 && (
            <div>
              <div className="font-medium text-amber-300">Inference boundary</div>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-amber-200/70">
                {rationale.inferenceNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>

      <details className="group rounded-xl border border-line bg-surface/35">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-neutral-300">
          <span className="flex items-center justify-between gap-3">
            Share kit · 3 screenshots + copy
            <span className="text-neutral-600 transition-transform group-open:rotate-180">
              ⌄
            </span>
          </span>
        </summary>
        <div className="space-y-4 border-t border-line px-4 py-4 text-xs">
          <ol className="grid gap-2 sm:grid-cols-3">
            {shareKit.screenshots.map((shot) => (
              <li key={shot.title} className="rounded-lg bg-surface-2/70 p-3">
                <div className="font-semibold text-neutral-200">{shot.title}</div>
                <p className="mt-1 leading-relaxed text-neutral-400">{shot.focus}</p>
                <p className="mt-2 text-[11px] leading-relaxed text-neutral-600">
                  Alt: {shot.altText}
                </p>
              </li>
            ))}
          </ol>
          <p className="rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-amber-300/80">
            {shareKit.privacyReminder}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => copy("x", shareKit.xPosts.join("\n\n---\n\n"))}
            >
              {copyStatus === "x" ? "X thread copied ✓" : "Copy X thread"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copy("linkedin", shareKit.linkedIn)}
            >
              {copyStatus === "linkedin" ? "LinkedIn copied ✓" : "Copy LinkedIn version"}
            </Button>
          </div>
          {copyStatus === "failed" && (
            <p className="text-red-300" role="alert">
              Copy failed — select the text from your exported plan instead.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
