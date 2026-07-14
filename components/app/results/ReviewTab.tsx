import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ExecutionProgress } from "./ExecutionProgress";
import { weeklyReview } from "@/lib/today";
import { experimentLifecycle, latestRelevantExperiment } from "@/lib/execution";
import { clipString } from "@/lib/coerce";
import type { MarketingStrategy, OutcomeCheckpoint, WorkspaceState } from "@/lib/types";

/** Actionable weekly learning surface, projected from the same experiment state as Today. */
export function ReviewTab({
  workspace,
  strategy,
  now = new Date(),
  onGoToday,
  onRecord,
  onSchedule,
}: {
  workspace: WorkspaceState;
  strategy: MarketingStrategy | null;
  now?: Date;
  onGoToday: () => void;
  onRecord: (experimentId: string, checkpoint: OutcomeCheckpoint) => void;
  onSchedule: (platformId: string) => void;
}) {
  const review = weeklyReview({ workspace, strategy }, now);
  const activeExperiment = latestRelevantExperiment(workspace);
  const lifecycle = activeExperiment
    ? experimentLifecycle(activeExperiment, now)
    : undefined;
  const measuredChannels = review.channels.filter((channel) => channel.outcomes > 0);

  return (
    <section className="space-y-5">
      <Card className="p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Completed experiments · last 7 days
            </h2>
            <p className="mt-1 text-5xl font-bold text-accent-300">
              {review.loopsThisWeek}
            </p>
            <p className="mt-1 max-w-xl text-xs text-neutral-500">
              Complete means you published, recorded a result and received a verdict. Drafts
              alone do not count.
            </p>
          </div>
          {review.bestAngle && (
            <div className="max-w-sm rounded-lg bg-surface-2 px-4 py-3 text-right">
              <div className="text-xs uppercase tracking-wide text-neutral-500">
                Best angle so far
              </div>
              <div className="mt-1 text-sm text-neutral-200">
                “{clipString(review.bestAngle, 90)}”
              </div>
            </div>
          )}
        </div>
      </Card>

      {activeExperiment && lifecycle && !lifecycle.complete && (
        <Card className="border-accent-800/70 bg-accent-950/20 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-accent-300">
                What happens next · {activeExperiment.platformName}
              </div>
              <h3 className="mt-1 text-lg font-semibold text-neutral-100">
                {lifecycle.headline}
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-neutral-400">{lifecycle.detail}</p>
            </div>
            {lifecycle.due && lifecycle.nextCheckpoint ? (
              <Button
                onClick={() => onRecord(activeExperiment.id, lifecycle.nextCheckpoint!)}
              >
                Record {lifecycle.nextCheckpoint} results
              </Button>
            ) : (
              <Button variant="outline" onClick={onGoToday}>
                View today&apos;s work
              </Button>
            )}
          </div>
          <div className="mt-5">
            <ExecutionProgress steps={lifecycle.steps} />
          </div>
        </Card>
      )}

      {measuredChannels.length > 0 && (
        <Card className="p-6">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Evidence by channel
          </h3>
          <div className="space-y-1.5 text-sm">
            {measuredChannels.map((channel) => (
              <div
                key={channel.platformId}
                className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 px-3 py-2"
              >
                <span className="min-w-0 flex-1 font-medium text-neutral-100">
                  {channel.platformName}
                </span>
                <span className="text-xs text-neutral-500">
                  {channel.experiments} experiment
                  {channel.experiments === 1 ? "" : "s"} · {channel.outcomes} result
                  {channel.outcomes === 1 ? "" : "s"}
                </span>
                {channel.bestCall && (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-neutral-300">
                    best: {channel.bestCall}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Recommended next experiment
        </h3>
        {review.unprovenChannel ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-surface-2/50 p-4">
            <div>
              <div className="font-medium text-neutral-100">
                Test {review.unprovenChannel.platformName}
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                It is the highest-ranked channel in your strategy without an experiment yet.
              </p>
            </div>
            <Button onClick={() => onSchedule(review.unprovenChannel!.platformId)}>
              Prepare {review.unprovenChannel.platformName} →
            </Button>
          </div>
        ) : (
          <div className="mt-3">
            <ul className="space-y-1.5 text-sm text-neutral-300">
              {review.suggestions.map((suggestion, index) => (
                <li key={index}>· {suggestion}</li>
              ))}
            </ul>
            <Button className="mt-4" variant="outline" onClick={onGoToday}>
              Continue from Today
            </Button>
          </div>
        )}
      </Card>
    </section>
  );
}
