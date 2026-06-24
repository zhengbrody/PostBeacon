import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PriorityBadge } from "@/components/ui/Badge";
import type { MarketingStrategy, PlatformRecommendation } from "@/lib/types";

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
      <Card className="border-accent-700/50 bg-accent-600/10 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-accent-300">
          Positioning
        </h2>
        <p className="mt-1.5 text-sm text-neutral-100">{strategy.positioning}</p>
        <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide text-accent-300">
          The play
        </h2>
        <p className="mt-1.5 text-sm text-neutral-100">{strategy.overallStrategy}</p>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Channels, ranked for your product</h2>
          <span className="text-xs text-neutral-500">{selected.length} selected</span>
        </div>
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
          <p className="mb-3 text-xs text-neutral-500">
            AI-suggested — verify each link before posting (community invites can change).
          </p>
          <ul className="space-y-2 text-sm">
            {strategy.discoveries.map((d, i) => (
              <li key={i} className="rounded-lg bg-surface-2 px-3 py-2">
                <a href={d.url} target="_blank" rel="noreferrer" className="font-medium text-accent-300">
                  {d.name}
                </a>
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
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium">{rec.platformName}</span>
          <PriorityBadge priority={rec.priority} />
          <span className="ml-auto font-mono text-xs text-neutral-400">{rec.score}</span>
        </span>
        <span className="mt-1.5 block h-1 w-full overflow-hidden rounded bg-neutral-800">
          <span className="block h-1 rounded bg-accent-500" style={{ width: `${rec.score}%` }} />
        </span>
        <span className="mt-1.5 block text-xs text-neutral-400">{rec.rationale}</span>
        {rec.angle && <span className="mt-1 block text-xs text-accent-300">↳ {rec.angle}</span>}
      </span>
    </button>
  );
}
