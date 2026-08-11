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
import {
  effortEstimate,
  observableSignal,
  rankComparison,
  rankRecommendations,
} from "@/lib/strategyDecision";
import { isSafeExternalHref } from "@/lib/urlPolicy";
import type {
  MarketingStrategy,
  PlatformRecommendation,
  ScoreBreakdown,
  ScoreDimensionKey,
  SuccessContract,
} from "@/lib/types";

const effortLabel: Record<NonNullable<PlatformRecommendation["effort"]>, string> = {
  low: "Low effort",
  medium: "Medium effort",
  high: "High effort",
};

export function StrategyView({
  strategy,
  selected,
  successContract,
  preparablePlatformIds,
  onSelect,
  loading,
  onBack,
  onGenerate,
}: {
  strategy: MarketingStrategy;
  selected: string[];
  successContract?: SuccessContract;
  preparablePlatformIds?: string[];
  onSelect: (id: string) => void;
  loading: boolean;
  onBack: () => void;
  onGenerate: () => void;
}) {
  const [compareOpen, setCompareOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const ranked = rankRecommendations(strategy.recommendations);
  const selectedId = selected.find((id) => ranked.some((rec) => rec.platformId === id));
  const choice = ranked.find((rec) => rec.platformId === selectedId) ?? ranked[0] ?? null;
  const choiceRank = choice
    ? ranked.findIndex((rec) => rec.platformId === choice.platformId) + 1
    : 0;
  const postEstimate = choice
    ? (PLATFORMS.find((platform) => platform.id === choice.platformId)?.postCount ?? 1)
    : 0;
  const canPreparePlatform = (platformId: string) =>
    !preparablePlatformIds || preparablePlatformIds.includes(platformId);
  const choicePrepared = canPreparePlatform(choice.platformId);

  if (!choice) {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold">No channel decision is available</h2>
        <p className="mt-2 text-sm text-neutral-400">
          The strategy did not contain a usable platform recommendation. Go back and rebuild
          it before generating content.
        </p>
        <Button className="mt-4" variant="outline" onClick={onBack}>
          ← Back to Diagnose
        </Button>
      </Card>
    );
  }

  const intentReason = choice.breakdown?.intentFit.reason;
  const riskReason = choice.breakdown?.risk.reason;
  const venue = choice.venue?.trim();

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="border-b border-line bg-accent-950/20 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-300">
                {choiceRank === 1
                  ? "Recommended next experiment"
                  : `Selected alternative · ranked #${choiceRank}`}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold text-neutral-100">
                  {choice.platformName}
                </h2>
                <PriorityBadge priority={choice.priority} />
                <span className="font-mono text-xs text-neutral-400">
                  {choice.score}/100
                </span>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-300">
                {choice.bestMove || choice.angle || choice.rationale}
              </p>
            </div>
            <div className="rounded-lg border border-line bg-surface/70 px-3 py-2 text-right">
              <p className="text-[10px] uppercase tracking-wide text-neutral-500">Venue</p>
              <p className="mt-0.5 max-w-56 text-xs text-neutral-200">
                {venue || "Not verified yet — confirm before posting"}
              </p>
              <ProvenanceTag rec={choice} />
            </div>
          </div>
        </div>

        <div className="grid gap-px bg-line sm:grid-cols-2">
          <DecisionCell label="Why now" value={choice.rationale} />
          <DecisionCell
            label="Fit to your goal"
            value={
              successContract
                ? `${successContract.primaryGoal}. ${intentReason || "The channel fit is reflected in the computed score above."}`
                : intentReason || "This legacy plan has no stored goal-fit explanation."
            }
          />
          <DecisionCell label="Estimated effort" value={effortEstimate(choice)} />
          <DecisionCell
            label="Main risk"
            value={
              riskReason ||
              "No detailed risk rating is stored for this legacy recommendation."
            }
          />
          <DecisionCell
            label="Observable signal"
            value={observableSignal(successContract)}
          />
          <DecisionCell
            label={choiceRank === 1 ? "Why #1 beats #2" : "Ranking trade-off"}
            value={rankComparison(choice, ranked)}
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-line p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <p className="text-xs leading-relaxed text-neutral-500">
            {choicePrepared ? (
              <>
                Prepares {postEstimate} {postEstimate === 1 ? "draft" : "drafts"} for this
                channel only. Nothing is posted automatically; all{" "}
                {strategy.recommendations.length} ranked channels stay in the library.
              </>
            ) : (
              <>
                This fictional walkthrough has no baked draft for {choice.platformName}.
                Choose one of the prepared example channels; a real project can prepare any
                ranked channel on demand.
              </>
            )}
          </p>
          <Button
            className="min-h-11 shrink-0"
            onClick={onGenerate}
            disabled={loading || !selectedId || !choicePrepared}
          >
            {loading
              ? "Preparing…"
              : choicePrepared
                ? "Prepare this experiment →"
                : "Example draft not included"}
          </Button>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11"
          variant="outline"
          aria-expanded={compareOpen}
          onClick={() => setCompareOpen((open) => !open)}
        >
          {compareOpen ? "Hide alternatives" : "Compare alternatives"}
        </Button>
        <Button
          className="min-h-11"
          variant="outline"
          aria-expanded={allOpen}
          onClick={() => setAllOpen((open) => !open)}
        >
          {allOpen
            ? "Hide channel library"
            : `Explore all ${strategy.recommendations.length} channels`}
        </Button>
      </div>

      {compareOpen && (
        <Card className="p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Top alternatives</h2>
            <p className="mt-1 text-xs text-neutral-500">
              The rank is the decision default, not a lock. Choose another channel when you
              have better access to its audience or venue.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {ranked.slice(0, 3).map((rec, index) => (
              <button
                key={rec.platformId}
                type="button"
                aria-pressed={rec.platformId === choice.platformId}
                onClick={() => onSelect(rec.platformId)}
                className={`min-h-32 rounded-xl border p-4 text-left transition-colors ${
                  rec.platformId === choice.platformId
                    ? "border-accent-500 bg-accent-600/10"
                    : "border-line bg-surface-2 hover:border-neutral-600"
                }`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                    Rank #{index + 1}
                  </span>
                  <span className="font-mono text-xs text-neutral-400">{rec.score}</span>
                </span>
                <span className="mt-2 block text-sm font-semibold text-neutral-100">
                  {rec.platformName}
                </span>
                <span className="mt-1 line-clamp-3 block text-xs leading-relaxed text-neutral-400">
                  {rec.bestMove || rec.rationale}
                </span>
                <span className="mt-3 block text-xs font-medium text-accent-300">
                  {rec.platformId === choice.platformId
                    ? "Selected ✓"
                    : canPreparePlatform(rec.platformId)
                      ? "Choose this"
                      : "Inspect only in example"}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {allOpen && (
        <Card className="p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">Full channel library</h2>
              <p className="mt-1 text-xs text-neutral-500">
                Every score remains inspectable. Selecting a channel changes the single
                experiment above; it does not generate a multi-channel batch.
              </p>
            </div>
            <span className="text-xs text-neutral-500">1 selected</span>
          </div>
          <div className="space-y-2">
            {ranked.map((rec) => (
              <RecRow
                key={rec.platformId}
                rec={rec}
                selected={rec.platformId === choice.platformId}
                onSelect={() => onSelect(rec.platformId)}
              />
            ))}
          </div>
        </Card>
      )}

      <details className="rounded-xl border border-line bg-surface/40 p-5 sm:p-6">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-neutral-300 hover:text-white">
          Review the full strategic rationale
        </summary>
        <div className="mt-4 space-y-6 border-t border-line pt-6">
          <PositioningCard strategy={strategy} />
          {strategy.audienceSegments && (
            <AudienceCard segments={strategy.audienceSegments} />
          )}
          {strategy.phases && <LaunchPlanCard phases={strategy.phases} />}
          {strategy.discoveries && strategy.discoveries.length > 0 && (
            <NicheChannels strategy={strategy} />
          )}
        </div>
      </details>

      <div className="flex gap-3 border-t border-line pt-4">
        <Button variant="outline" onClick={onBack}>
          ← Back to Diagnose
        </Button>
      </div>
    </div>
  );
}

function DecisionCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-surface/80 p-5 sm:p-6">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-neutral-300">{value}</p>
    </div>
  );
}

function NicheChannels({ strategy }: { strategy: MarketingStrategy }) {
  const discoveries = strategy.discoveries ?? [];
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Niche venues to verify</h2>
      {discoveries.some((discovery) => !discovery.validated) && (
        <p className="mb-3 text-xs text-neutral-500">
          Unchecked links are model suggestions. Verify the venue and its rules before
          posting.
        </p>
      )}
      <ul className="space-y-2 text-sm">
        {discoveries.map((discovery, index) => (
          <li key={index} className="rounded-lg bg-surface-2 px-3 py-2">
            {isSafeExternalHref(discovery.url) ? (
              <a
                href={discovery.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-accent-300"
              >
                {discovery.name}
              </a>
            ) : (
              <span className="font-medium text-accent-300">{discovery.name}</span>
            )}
            {discovery.validated && (
              <span className="ml-2 align-middle text-xs text-emerald-400">
                ✓ link checked
              </span>
            )}
            <span className="text-neutral-400"> — {discovery.why}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const DIM_LABELS: { key: ScoreDimensionKey; label: string; note?: string }[] = [
  { key: "audienceFit", label: "Audience fit" },
  { key: "intentFit", label: "Intent fit" },
  { key: "nativeContentFit", label: "Native content fit" },
  { key: "founderAccess", label: "Founder access" },
  { key: "effort", label: "Effort", note: "from catalog · lower is better" },
  { key: "risk", label: "Risk", note: "lower is better" },
  {
    key: "evidenceQuality",
    label: "Evidence quality",
    note: "computed from fact grounding",
  },
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
        The 0–100 total is a fixed weighted sum computed by PostBeacon, not by the model —
        the model only supplies the ratings and reasons above.
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
  selected,
  onSelect,
}: {
  rec: PlatformRecommendation;
  selected: boolean;
  onSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        selected
          ? "border-accent-500 bg-accent-600/10"
          : "border-line bg-surface-2 hover:border-neutral-600"
      }`}
    >
      <button
        onClick={onSelect}
        aria-pressed={selected}
        className="flex w-full items-start gap-3 text-left"
      >
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs ${
            selected ? "bg-accent-600 text-white" : "bg-neutral-700"
          }`}
        >
          {selected ? "✓" : ""}
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
            <span
              className="block h-1 rounded bg-accent-500"
              style={{ width: `${rec.score}%` }}
            />
          </span>
          {rec.fallback ? (
            <span className="mt-1.5 block text-xs text-amber-300">{rec.rationale}</span>
          ) : (
            <span className="mt-1.5 block text-xs text-neutral-400">{rec.rationale}</span>
          )}
          {rec.angle && (
            <span className="mt-1 block text-xs text-accent-300">↳ {rec.angle}</span>
          )}
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
