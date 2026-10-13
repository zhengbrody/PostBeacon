"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ExecutionProgress } from "./ExecutionProgress";
import { parseMetric } from "@/lib/coerce";
import { nextActionsAfter } from "@/lib/today";
import { experimentLifecycle } from "@/lib/execution";
import { effectiveExperimentVerdict, outcomeVerdict } from "@/lib/experimentHistory";
import { normalizeTrackedUrl } from "@/lib/trackedUrl";
import {
  OUTCOME_METRICS,
  SIGNAL_LABELS,
  channelMetrics,
  signalLabel,
  successContractSummary,
} from "@/lib/successContract";
import { checkpointDeltas } from "@/lib/learningEvidence";
import type {
  Experiment,
  MarketingStrategy,
  Outcome,
  OutcomeCheckpoint,
  OutcomeMetric,
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
        className="mt-1 block min-h-11 w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent-500"
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
  nextExperimentControls,
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
  nextExperimentControls?: React.ReactNode;
  mode?: "modal" | "inline";
}) {
  const [phase, setPhase] = useState<"form" | "feedback">("form");
  const [inputs, setInputs] = useState<Partial<Record<OutcomeMetric, string>>>({});
  const [unavailable, setUnavailable] = useState<OutcomeMetric[]>([]);
  const [invalidatedReason, setInvalidatedReason] =
    useState<Outcome["invalidatedReason"]>();
  const [inputNotice, setInputNotice] = useState("");
  const [qualitative, setQualitative] = useState("");

  const anyFilled =
    Boolean(invalidatedReason) ||
    unavailable.length > 0 ||
    [...Object.values(inputs), qualitative].some((v) => v.trim() !== "");

  function save() {
    const values = Object.fromEntries(
      OUTCOME_METRICS.map((metric) => [
        metric,
        unavailable.includes(metric) ? undefined : parseMetric(inputs[metric] ?? ""),
      ])
    );
    onSave({
      id: crypto.randomUUID(),
      checkpoint,
      recordedAt: new Date().toISOString(),
      // Absent means "not measured" — never coerced to 0 (parseMetric also
      // rejects NaN/Infinity from pasted values like "12,000" or "1e999").
      ...values,
      unavailableMetrics: unavailable,
      invalidatedReason,
      qualitativeFeedback: qualitative.trim() || undefined,
    });
    setPhase("feedback");
  }

  const verdict =
    outcomeVerdict(experiment, checkpoint)?.verdict ??
    effectiveExperimentVerdict(experiment);
  const trackedHref = normalizeTrackedUrl(experiment.trackedUrl);
  const lifecycle = experimentLifecycle(experiment, new Date());
  const checkpointLabel =
    checkpoint === "manual" ? "Early result" : `${checkpoint} results`;
  const contract = experiment.successContract;
  const fields = channelMetrics(experiment.platformId, contract?.primarySignal);
  const latestOutcome = [...experiment.outcomes]
    .reverse()
    .find((item) => item.checkpoint === checkpoint);
  const deltas = latestOutcome ? checkpointDeltas(experiment, latestOutcome) : [];
  function metricField(metric: OutcomeMetric) {
    const isUnavailable = unavailable.includes(metric);
    return (
      <div key={metric}>
        <NumField
          label={
            metric === "custom" && contract ? signalLabel(contract) : SIGNAL_LABELS[metric]
          }
          value={isUnavailable ? "" : (inputs[metric] ?? "")}
          onChange={(value) => {
            setUnavailable((items) => items.filter((item) => item !== metric));
            setInputs((current) => ({ ...current, [metric]: value }));
          }}
        />
        <label className="mt-2 flex min-h-11 items-center gap-2 text-[11px] text-neutral-400">
          <input
            type="checkbox"
            checked={isUnavailable}
            onChange={(event) => {
              setUnavailable((items) =>
                event.target.checked
                  ? [...items.filter((item) => item !== metric), metric]
                  : items.filter((item) => item !== metric)
              );
              setInputs((current) => ({ ...current, [metric]: "" }));
            }}
          />
          Unavailable / cannot measure
        </label>
      </div>
    );
  }

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
            {trackedHref
              ? "Use the live-post link below if you need it. "
              : "Open the platform's analytics if you need it. "}
            Leave anything you didn&apos;t measure empty — empty is honest, 0 is a claim.
          </p>
          {trackedHref ? (
            <a
              href={trackedHref}
              target="_blank"
              rel="noreferrer"
              className="mb-3 inline-block text-xs font-medium text-accent-300 hover:underline"
            >
              Open the live post →
            </a>
          ) : experiment.trackedUrl ? (
            <p className="mb-3 text-xs text-neutral-500">
              The saved live-post link is invalid and cannot be opened.
            </p>
          ) : null}
          <div className="mb-4 rounded-lg border border-line bg-surface-2/40 p-3">
            <div className="text-xs font-medium text-neutral-300">
              Checked the replies and found none?
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
              This sets only replies to 0. Reach, clicks, signups and revenue remain unknown
              unless you measure them.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={loading}
              onClick={() => {
                setInputs((current) => ({ ...current, replies: "0" }));
                setUnavailable((items) => items.filter((item) => item !== "replies"));
                setInputNotice(
                  "Replies set to 0. No other observation changed. Review the form, then save."
                );
              }}
            >
              I observed zero replies
            </Button>
          </div>
          {inputNotice && (
            <p className="mb-3 text-xs text-accent-300" role="status">
              {inputNotice}
            </p>
          )}
          <label className="mb-4 block text-xs text-neutral-400">
            Is this experiment usable?
            <select
              className="mt-1 min-h-11 w-full rounded-md border border-line bg-surface-2 px-2 text-sm"
              value={invalidatedReason ?? ""}
              onChange={(event) =>
                setInvalidatedReason(
                  (event.target.value || undefined) as Outcome["invalidatedReason"]
                )
              }
            >
              <option value="">Usable / no known interference</option>
              <option value="post-removed">Post removed</option>
              <option value="tracking-broken">Tracking broken</option>
              <option value="wrong-audience">Wrong audience</option>
              <option value="external-event">Major external event</option>
              <option value="other">Other interference</option>
            </select>
            {invalidatedReason && (
              <span className="mt-1 block text-amber-300">
                Kept in history, excluded from winning/losing memory.
              </span>
            )}
          </label>
          {contract ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-accent-700/40 bg-accent-600/10 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-accent-300">
                  Primary signal
                </div>
                <p className="mt-1 text-sm text-neutral-200">
                  {successContractSummary(contract)}
                </p>
                {contract.baseline !== undefined && (
                  <p className="mt-1 text-xs text-neutral-500">
                    Comparable baseline: {contract.primarySignal === "revenue" ? "$" : ""}
                    {contract.baseline}
                  </p>
                )}
                <div className="mt-3 max-w-xs">{metricField(contract.primarySignal)}</div>
              </div>
              <details className="rounded-lg border border-line bg-surface-2/30">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-xs text-neutral-400">
                  Additional observations · optional
                  <span className="text-accent-300">Add metrics ↓</span>
                </summary>
                <div className="grid grid-cols-2 gap-3 border-t border-line p-3 sm:grid-cols-3">
                  {fields
                    .filter((metric) => metric !== contract.primarySignal)
                    .map(metricField)}
                </div>
              </details>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {fields.map(metricField)}
            </div>
          )}
          <details className="mt-3">
            <summary className="min-h-11 cursor-pointer text-xs text-neutral-400">
              Other measured signals (including legacy metrics)
            </summary>
            <div className="grid grid-cols-2 gap-3">
              {OUTCOME_METRICS.filter(
                (metric) => !fields.includes(metric) && metric !== "custom"
              ).map(metricField)}
            </div>
          </details>
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
            <Button disabled={!anyFilled || loading} onClick={() => save()}>
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
                  {verdict.assessment?.replaceAll("-", " ") ??
                    CALL_STYLE[verdict.call].label}
                </span>
              </p>
              <p className="mt-3 text-sm text-neutral-200">{verdict.reason}</p>
              {deltas.length > 0 && (
                <div className="mt-3 rounded-lg border border-line p-3 text-xs text-neutral-300">
                  <p>72h cumulative result minus 24h</p>
                  {deltas.map((item) => (
                    <p key={item.metric}>
                      {SIGNAL_LABELS[item.metric]}: {item.delta >= 0 ? "+" : ""}
                      {item.delta}
                      {item.delta < 0
                        ? " · reported cumulative value decreased; verify the source"
                        : ""}
                    </p>
                  ))}
                </div>
              )}
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
              {nextExperimentControls ?? (
                <div className="mt-5 flex flex-wrap gap-2">
                  {verdict.assessment !== "insufficient" &&
                  verdict.assessment !== "invalidated" &&
                  verdict.call === "no-signal" &&
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
              )}
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
