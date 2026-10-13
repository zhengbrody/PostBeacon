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
  productUrl,
  variable,
  heldConstant,
}: {
  content: PlatformContent;
  facts: Fact[];
  post: PlatformPost;
  profile: ProductProfile;
  recommendation?: PlatformRecommendation;
  successContract?: SuccessContract;
  hookChange?: { from: string; to: string };
  productUrl?: string;
  variable?: import("@/lib/types").TestedVariable;
  heldConstant?: string;
}) {
  const [copyStatus, setCopyStatus] = useState<"x" | "linkedin" | "failed" | null>(null);
  const [shareMode, setShareMode] = useState<"product" | "process">("product");
  const contract = projectExperimentContract({
    profile,
    recommendation,
    content,
    post,
    successContract,
    variable,
  });
  const rationale = explainDraft({ facts, recommendation, content });
  const shareKit = buildShareKit({
    profile,
    recommendation,
    content,
    post,
    successContract,
    facts,
    productUrl,
    shareMode,
  });

  async function copy(label: "x" | "linkedin", value: string) {
    if (!shareKit.copyReady) return;
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
            {contract.variable}
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
            <dd className="mt-0.5 text-neutral-200">
              {contract.variable} · {contract.candidate}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">Comparison boundary</dt>
            <dd className="mt-0.5 text-neutral-200">
              {heldConstant || "First exploratory test; no controlled comparison claimed."}{" "}
              · Angle: {contract.angle}
            </dd>
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
            Share kit · screenshot instructions + copy
            <span className="text-neutral-600 transition-transform group-open:rotate-180">
              ⌄
            </span>
          </span>
        </summary>
        <div className="space-y-4 border-t border-line px-4 py-4 text-xs">
          <label className="block text-neutral-400">
            What are you sharing?
            <select
              value={shareMode}
              onChange={(event) => {
                setShareMode(event.target.value as "product" | "process");
                setCopyStatus(null);
              }}
              className="mt-1 min-h-11 w-full rounded-md border border-line bg-surface-2 px-2"
            >
              <option value="product">Promote my product</option>
              <option value="process">Share my building / experiment process</option>
            </select>
          </label>
          <p className="text-neutral-500">
            These are screenshot instructions, not generated images. Capture your real
            product and label sample data.
          </p>
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
              disabled={!shareKit.copyReady}
              onClick={() => copy("x", shareKit.xPosts.join("\n\n---\n\n"))}
            >
              {copyStatus === "x" ? "X thread copied ✓" : "Copy X thread"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!shareKit.copyReady}
              onClick={() => copy("linkedin", shareKit.linkedIn)}
            >
              {copyStatus === "linkedin" ? "LinkedIn copied ✓" : "Copy LinkedIn version"}
            </Button>
          </div>
          <details>
            <summary className="min-h-11 cursor-pointer text-neutral-300">
              Review exact copy before using it
            </summary>
            {shareKit.xPosts.map((text, index) => (
              <pre
                key={index}
                className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 font-sans"
              >
                {index + 1}/3 · {text}
              </pre>
            ))}
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 font-sans">
              LinkedIn: {shareKit.linkedIn}
            </pre>
          </details>
          {shareKit.issues.length > 0 && (
            <ul className="list-disc pl-4 text-amber-300" role="alert">
              {shareKit.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
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
