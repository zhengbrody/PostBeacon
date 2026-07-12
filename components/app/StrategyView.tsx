import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PriorityBadge } from "@/components/ui/Badge";
import {
  AudienceCard,
  LaunchPlanCard,
  PositioningCard,
} from "@/components/app/PlanSummary";
import { PLATFORMS } from "@/lib/platforms";
import { SCORE_WEIGHTS } from "@/lib/scoring";
import { isSafeExternalHref } from "@/lib/urlPolicy";
import type {
  MarketingStrategy,
  PlatformRecommendation,
  ScoreBreakdown,
  ScoreDimensionKey,
} from "@/lib/types";

const effortLabel: Record<NonNullable<PlatformRecommendation["effort"]>, string> = {
  low: "Low effort",
  medium: "Medium effort",
  high: "High effort",
};

export function StrategyView({
  strategy,
  selected,
  onToggle,
  loading,
  onBack,
  onGenerate,
}: {
  strategy: MarketingStrategy;
  selected: string[];
  onToggle: (id: string) => void;
  loading: boolean;
  onBack: () => void;
  onGenerate: () => void;
}) {
  // What the current selection turns into, so the choice feels concrete.
  const postEstimate = selected.reduce(
    (n, id) => n + (PLATFORMS.find((p) => p.id === id)?.postCount ?? 1),
    0
  );
  return (
    <div className="space-y-6">
      <PositioningCard strategy={strategy} />

      {strategy.audienceSegments && (
        <AudienceCard segments={strategy.audienceSegments} />
      )}

      {strategy.phases && <LaunchPlanCard phases={strategy.phases} />}

      <Card className="p-6">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Channels, ranked for your product</h2>
          <span className="text-xs text-neutral-500">{selected.length} selected</span>
        </div>
        <p className="mb-4 text-xs text-neutral-500">
          We pre-checked your best-scoring channels. Content is written{" "}
          <span className="font-medium text-neutral-300">
            only for checked channels
          </span>{" "}
          — fewer channels means a tighter plan you&apos;ll actually execute.
          Current pick ≈ {postEstimate} ready-to-post drafts +{" "}
          {selected.length} playbooks. You can add more channels later from the
          results page.
        </p>
        <div className="space-y-2">
          {strategy.recommendations.map((r) => (
            <RecRow
              key={r.platformId}
              rec={r}
              on={selected.includes(r.platformId)}
              onToggle={() => onToggle(r.platformId)}
            />
          ))}
        </div>
      </Card>

      {strategy.discoveries && strategy.discoveries.length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold">🔎 Niche channels to check out</h2>
          {strategy.discoveries.some((d) => !d.validated) && (
            <p className="mb-3 text-xs text-neutral-500">
              Unchecked links are AI-suggested — verify before posting (community
              invites can change).
            </p>
          )}
          <ul className="space-y-2 text-sm">
            {strategy.discoveries.map((d, i) => (
              <li key={i} className="rounded-lg bg-surface-2 px-3 py-2">
                {/* Discovery URLs come from model/search output — only link http(s). */}
                {isSafeExternalHref(d.url) ? (
                  <a href={d.url} target="_blank" rel="noreferrer" className="font-medium text-accent-300">
                    {d.name}
                  </a>
                ) : (
                  <span className="font-medium text-accent-300">{d.name}</span>
                )}
                {d.validated && (
                  <span className="ml-2 align-middle text-xs text-emerald-400">✓ link checked</span>
                )}
                <span className="text-neutral-400"> — {d.why}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}>
          ← Back
        </Button>
        <Button onClick={onGenerate} disabled={!selected.length || loading}>
          Generate {postEstimate} posts for {selected.length}{" "}
          {selected.length === 1 ? "channel" : "channels"} →
        </Button>
      </div>
    </div>
  );
}

const DIM_LABELS: { key: ScoreDimensionKey; label: string; note?: string }[] = [
  { key: "audienceFit", label: "Audience fit" },
  { key: "intentFit", label: "Intent fit" },
  { key: "nativeContentFit", label: "Native content fit" },
  { key: "founderAccess", label: "Founder access" },
  { key: "effort", label: "Effort", note: "from catalog · lower is better" },
  { key: "risk", label: "Risk", note: "lower is better" },
  { key: "evidenceQuality", label: "Evidence quality", note: "computed from fact grounding" },
];

/** The explainable score: per-dimension bars + reasons. Total is code-computed. */
function BreakdownPanel({ breakdown }: { breakdown: ScoreBreakdown }) {
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-surface p-3">
      {DIM_LABELS.map(({ key, label, note }) => {
        const dim = breakdown[key];
        if (!dim) return null;
        const inverted = key === "effort" || key === "risk";
        return (
          <div key={key} className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[11rem_1fr]">
            <div className="flex items-baseline justify-between gap-2 sm:block">
              <span className="text-xs font-medium text-neutral-300">{label}</span>
              <span className="text-[10px] text-neutral-500">
                {" "}
                {Math.round(SCORE_WEIGHTS[key] * 100)}%{note ? ` · ${note}` : ""}
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="block h-1 w-24 shrink-0 overflow-hidden rounded bg-neutral-800">
                  <span
                    className={`block h-1 rounded ${inverted ? "bg-amber-500/70" : "bg-accent-500"}`}
                    style={{ width: `${dim.score * 10}%` }}
                  />
                </span>
                <span className="font-mono text-[11px] text-neutral-400">
                  {dim.score}/10
                </span>
              </div>
              {dim.reason && (
                <p className="mt-0.5 text-xs text-neutral-500">{dim.reason}</p>
              )}
            </div>
          </div>
        );
      })}
      <p className="border-t border-line pt-2 text-[11px] text-neutral-500">
        The 0–100 total is a fixed weighted sum computed by PostBeacon, not by the
        model — the model only supplies the ratings and reasons above.
      </p>
    </div>
  );
}

function ProvenanceTag({ rec }: { rec: PlatformRecommendation }) {
  if (!rec.bestMove && !rec.venue) return null;
  if (rec.provenance === "grounded" && rec.sources?.length) {
    const href = rec.sources[0];
    return isSafeExternalHref(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-[10px] font-medium text-emerald-400 hover:underline"
        title="Matches a community found and link-checked via live search"
      >
        ✓ sourced
      </a>
    ) : (
      <span className="text-[10px] font-medium text-emerald-400">✓ sourced</span>
    );
  }
  return (
    <span
      className="text-[10px] text-neutral-500"
      title="Named by the model without a checked source — verify the venue exists before posting"
    >
      inferred
    </span>
  );
}

function RecRow({
  rec,
  on,
  onToggle,
}: {
  rec: PlatformRecommendation;
  on: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        on ? "border-accent-500 bg-accent-600/10" : "border-line bg-surface-2 hover:border-neutral-600"
      }`}
    >
      <button onClick={onToggle} aria-pressed={on} className="flex w-full items-start gap-3 text-left">
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs ${
            on ? "bg-accent-600 text-white" : "bg-neutral-700"
          }`}
        >
          {on ? "✓" : ""}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{rec.platformName}</span>
            <PriorityBadge priority={rec.priority} />
            {rec.effort && (
              <span className="text-[10px] uppercase tracking-wide text-neutral-500">
                {effortLabel[rec.effort]}
              </span>
            )}
            <span className="ml-auto font-mono text-xs text-neutral-400">{rec.score}</span>
          </span>
          <span className="mt-1.5 block h-1 w-full overflow-hidden rounded bg-neutral-800">
            <span className="block h-1 rounded bg-accent-500" style={{ width: `${rec.score}%` }} />
          </span>
          {rec.fallback ? (
            <span className="mt-1.5 block text-xs text-amber-300">{rec.rationale}</span>
          ) : (
            <span className="mt-1.5 block text-xs text-neutral-400">{rec.rationale}</span>
          )}
          {rec.angle && <span className="mt-1 block text-xs text-accent-300">↳ {rec.angle}</span>}
        </span>
      </button>
      {rec.bestMove && (
        <p className="ml-8 mt-1 text-xs text-neutral-400">
          <span className="text-neutral-500">Best move:</span> {rec.bestMove}{" "}
          <ProvenanceTag rec={rec} />
        </p>
      )}
      {rec.breakdown && (
        <div className="ml-8 mt-1.5">
          <button
            className="text-[11px] font-medium text-neutral-500 hover:text-accent-300"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? "▾ Hide score breakdown" : "▸ Why this score"}
          </button>
          {open && <BreakdownPanel breakdown={rec.breakdown} />}
        </div>
      )}
    </div>
  );
}
