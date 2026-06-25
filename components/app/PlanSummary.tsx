import { Card } from "@/components/ui/Card";
import type {
  AudienceSegment,
  FounderTask,
  GtmPhase,
  IterationMetric,
  MarketingStrategy,
  RiskItem,
} from "@/lib/types";

/** Small uppercase accent heading used across the plan sections. */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-accent-300">
      {children}
    </h2>
  );
}

const tierLabel: Record<AudienceSegment["tier"], string> = {
  primary: "Primary",
  secondary: "Secondary",
  "early-adopter": "Early adopters",
};

/** Executive summary + positioning + anti-positioning + the play + cold start. */
export function PositioningCard({ strategy }: { strategy: MarketingStrategy }) {
  return (
    <Card className="border-accent-700/50 bg-accent-600/10 p-6">
      {strategy.executiveSummary && (
        <>
          <SectionHeading>Executive summary</SectionHeading>
          <p className="mt-1.5 text-sm text-neutral-100">
            {strategy.executiveSummary}
          </p>
        </>
      )}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <SectionHeading>Positioning</SectionHeading>
          <p className="mt-1.5 text-sm text-neutral-100">{strategy.positioning}</p>
        </div>
        {strategy.antiPositioning && (
          <div>
            <SectionHeading>Don&apos;t position it as</SectionHeading>
            <p className="mt-1.5 text-sm text-neutral-300">
              {strategy.antiPositioning}
            </p>
          </div>
        )}
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <SectionHeading>The play</SectionHeading>
          <p className="mt-1.5 text-sm text-neutral-100">
            {strategy.overallStrategy}
          </p>
        </div>
        {strategy.coldStart && (
          <div>
            <SectionHeading>Cold start (0 → first users)</SectionHeading>
            <p className="mt-1.5 text-sm text-neutral-100">{strategy.coldStart}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

export function AudienceCard({ segments }: { segments: AudienceSegment[] }) {
  if (!segments.length) return null;
  return (
    <Card className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Who you&apos;re talking to</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {segments.map((s, i) => (
          <div key={i} className="rounded-lg bg-surface-2 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-accent-300">
              {tierLabel[s.tier] ?? s.tier}
            </div>
            <div className="mt-1 text-sm font-medium text-neutral-100">
              {s.label}
            </div>
            <p className="mt-1.5 text-xs text-neutral-400">{s.description}</p>
            {s.whereTheyHang && (
              <p className="mt-2 text-xs text-neutral-500">
                <span className="text-neutral-400">Found in:</span>{" "}
                {s.whereTheyHang}
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function LaunchPlanCard({ phases }: { phases: GtmPhase[] }) {
  if (!phases.length) return null;
  return (
    <Card className="p-6">
      <h2 className="mb-4 text-lg font-semibold">The plan, in phases</h2>
      <div className="space-y-4">
        {phases.map((p, i) => (
          <div key={i} className="rounded-lg bg-surface-2 p-4">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="rounded-md bg-accent-700/40 px-2 py-0.5 text-xs font-medium text-accent-200">
                {p.window}
              </span>
              <span className="text-sm font-medium text-neutral-100">
                {p.focus}
              </span>
            </div>
            {p.actions.length > 0 && (
              <ul className="mt-2.5 space-y-1.5 text-sm text-neutral-300">
                {p.actions.map((a, j) => (
                  <li key={j} className="flex gap-2">
                    <span className="text-accent-400">→</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function FounderChecklistCard({ tasks }: { tasks: FounderTask[] }) {
  if (!tasks.length) return null;
  return (
    <Card className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Founder checklist</h2>
      <ul className="space-y-2 text-sm">
        {tasks.map((t, i) => (
          <li key={i} className="flex items-start gap-3 rounded-lg bg-surface-2 px-4 py-2.5">
            <span className="shrink-0 rounded-md bg-neutral-700 px-2 py-0.5 text-[11px] font-medium text-neutral-200">
              {t.when}
            </span>
            <span className="text-neutral-200">{t.task}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function RisksCard({ risks }: { risks: RiskItem[] }) {
  if (!risks.length) return null;
  return (
    <Card className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Where this goes sideways</h2>
      <div className="space-y-3">
        {risks.map((r, i) => (
          <div key={i} className="rounded-lg bg-surface-2 p-4">
            <div className="text-sm font-medium text-amber-300">{r.area}</div>
            <p className="mt-1 text-sm text-neutral-300">{r.risk}</p>
            <p className="mt-1.5 text-xs text-neutral-400">
              <span className="text-emerald-400">Avoid it:</span> {r.mitigation}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function IterationCard({ metrics }: { metrics: IterationMetric[] }) {
  if (!metrics.length) return null;
  return (
    <Card className="p-6">
      <h2 className="mb-4 text-lg font-semibold">After you post: what to watch</h2>
      <div className="space-y-3">
        {metrics.map((m, i) => (
          <div key={i} className="rounded-lg bg-surface-2 p-4">
            <div className="text-sm font-medium text-neutral-100">{m.signal}</div>
            <p className="mt-1 text-xs text-neutral-400">{m.read}</p>
            <p className="mt-1.5 text-xs text-neutral-400">
              <span className="text-accent-300">If it&apos;s weak:</span> {m.ifWeak}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
