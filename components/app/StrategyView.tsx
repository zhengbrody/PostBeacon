import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PriorityBadge } from "@/components/ui/Badge";
import {
  AudienceCard,
  LaunchPlanCard,
  PositioningCard,
} from "@/components/app/PlanSummary";
import type { MarketingStrategy, PlatformRecommendation } from "@/lib/types";

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
          Pick where to spend your limited time. We only write content for the
          channels you keep.
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
                <a href={d.url} target="_blank" rel="noreferrer" className="font-medium text-accent-300">
                  {d.name}
                </a>
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
          Generate content for {selected.length} channels →
        </Button>
      </div>
    </div>
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
  return (
    <button
      onClick={onToggle}
      aria-pressed={on}
      className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
        on ? "border-accent-500 bg-accent-600/10" : "border-line bg-surface-2 hover:border-neutral-600"
      }`}
    >
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
        <span className="mt-1.5 block text-xs text-neutral-400">{rec.rationale}</span>
        {rec.angle && <span className="mt-1 block text-xs text-accent-300">↳ {rec.angle}</span>}
        {rec.bestMove && (
          <span className="mt-1 block text-xs text-neutral-400">
            <span className="text-neutral-500">Best move:</span> {rec.bestMove}
          </span>
        )}
      </span>
    </button>
  );
}
