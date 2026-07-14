"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ExecutionProgress } from "./ExecutionProgress";
import { parseMetric } from "@/lib/coerce";
import { nextActionsAfter } from "@/lib/today";
import { experimentLifecycle } from "@/lib/execution";
import type {
  Experiment,
  MarketingStrategy,
  Outcome,
  OutcomeCheckpoint,
  VerdictCall,
} from "@/lib/types";

/**
 * Record a check-in's results, then get the read back IMMEDIATELY: the
 * verdict (rule-based, in code), what to continue/stop, ≤3 next actions,
 * and the one-click follow-up (variant) or stop suggestion.
 */

const CALL_STYLE: Record<VerdictCall, { label: string; cls: string }> = {
  supported: { label: "hypothesis supported", cls: "bg-emerald-500/15 text-emerald-300" },
  promising: { label: "promising", cls: "bg-accent-600/20 text-accent-300" },
  weak: { label: "weak signal", cls: "bg-amber-500/15 text-amber-300" },
  "no-signal": { label: "no signal", cls: "bg-surface-2 text-neutral-400" },
};

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs text-neutral-400">
      {label}
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="mt-1 block w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent-500"
      />
    </label>
  );
}

export function OutcomePanel({
  experiment,
  checkpoint,
  strategy,
  loading,
  onSave,
  onGenerateVariant,
  onStop,
  onClose,
  mode = "modal",
}: {
  experiment: Experiment;
  checkpoint: OutcomeCheckpoint;
  strategy: MarketingStrategy | null;
  loading: boolean;
  onSave: (outcome: Outcome) => void;
  onGenerateVariant: () => void;
  onStop: () => void;
  onClose: () => void;
  mode?: "modal" | "inline";
}) {
  const [phase, setPhase] = useState<"form" | "feedback">("form");
  const [impressions, setImpressions] = useState("");
  const [replies, setReplies] = useState("");
  const [clicks, setClicks] = useState("");
  const [signups, setSignups] = useState("");
  const [revenue, setRevenue] = useState("");
  const [qualitative, setQualitative] = useState("");

  const anyFilled = [impressions, replies, clicks, signups, revenue, qualitative].some(
    (v) => v.trim() !== ""
  );

  function save() {
    onSave({
      id: crypto.randomUUID(),
      checkpoint,
      recordedAt: new Date().toISOString(),
      // Absent means "not measured" — never coerced to 0 (parseMetric also
      // rejects NaN/Infinity from pasted values like "12,000" or "1e999").
      impressions: parseMetric(impressions),
      replies: parseMetric(replies),
      clicks: parseMetric(clicks),
      signups: parseMetric(signups),
      revenue: parseMetric(revenue),
      qualitativeFeedback: qualitative.trim() || undefined,
    });
    setPhase("feedback");
  }

  const verdict = experiment.verdict;
  const lifecycle = experimentLifecycle(experiment, new Date());
  const checkpointLabel =
    checkpoint === "manual" ? "Early result" : `${checkpoint} results`;

  const panel = (
    <Card
      className={
        mode === "inline"
          ? "border-0 bg-transparent p-0"
          : "max-h-[90vh] w-full max-w-lg overflow-y-auto p-6"
      }
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-5 rounded-lg border border-line bg-surface-2/40 p-3">
        <ExecutionProgress steps={lifecycle.steps} />
      </div>
      {phase === "form" ? (
        <>
          <h2 className="text-lg font-semibold">
            {checkpointLabel} — {experiment.platformName}
          </h2>
          <p className="mb-4 mt-1 text-xs text-neutral-500">
            {checkpoint === "manual"
              ? "Record only a real signal you can already see. This is an early read; the scheduled 24h and 72h checks remain. "
              : "Type or paste what you see on the live post. "}
            {experiment.trackedUrl
              ? "Use the live-post link below if you need it. "
              : "Open the platform's analytics if you need it. "}
            Leave anything you didn&apos;t measure empty — empty is honest, 0 is a claim.
          </p>
          {experiment.trackedUrl && (
            <a
              href={experiment.trackedUrl}
              target="_blank"
              rel="noreferrer"
              className="mb-3 inline-block text-xs font-medium text-accent-300 hover:underline"
            >
              Open the live post →
            </a>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NumField label="Impressions" value={impressions} onChange={setImpressions} />
            <NumField label="Replies" value={replies} onChange={setReplies} />
            <NumField label="Clicks" value={clicks} onChange={setClicks} />
            <NumField label="Signups" value={signups} onChange={setSignups} />
            <NumField label="Revenue ($)" value={revenue} onChange={setRevenue} />
          </div>
          <label className="mt-3 block text-xs text-neutral-400">
            What people said (paste comments, DMs, notes)
            <textarea
              value={qualitative}
              onChange={(e) => setQualitative(e.target.value)}
              rows={4}
              className="mt-1 block w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent-500"
            />
          </label>
          <div className="mt-5 flex gap-2">
            <Button disabled={!anyFilled} onClick={save}>
              Save & get the read
            </Button>
            <Button variant="outline" onClick={onClose}>
              Not yet
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2 className="text-lg font-semibold">The read</h2>
          {verdict ? (
            <>
              <p className="mt-3">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${CALL_STYLE[verdict.call].cls}`}
                >
                  {CALL_STYLE[verdict.call].label}
                </span>
              </p>
              <p className="mt-3 text-sm text-neutral-200">{verdict.reason}</p>
              <p className="mt-2 text-sm text-neutral-300">
                <span className="text-neutral-500">Where to spend the next hour: </span>
                {verdict.advice}
              </p>
              <div className="mt-4">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Next, in order
                </div>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-300">
                  {nextActionsAfter(experiment, verdict, strategy).map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ol>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {verdict.call === "no-signal" &&
                experiment.outcomes.some((o) => o.checkpoint === "72h") ? (
                  <Button
                    onClick={() => {
                      onStop();
                      onClose();
                    }}
                  >
                    ⏹ Stop this experiment
                  </Button>
                ) : (
                  <Button
                    disabled={loading}
                    onClick={() => {
                      onGenerateVariant();
                      onClose();
                    }}
                  >
                    ✦ Generate follow-up variant
                  </Button>
                )}
                <Button variant="outline" onClick={onClose}>
                  Back to Today
                </Button>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-neutral-400">Saving…</p>
          )}
        </>
      )}
    </Card>
  );

  if (mode === "inline") return <div className="no-print">{panel}</div>;
  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      {panel}
    </div>
  );
}
