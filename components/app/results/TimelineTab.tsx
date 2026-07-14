import { Card } from "@/components/ui/Card";
import { ExecutionProgress } from "./ExecutionProgress";
import { timelineEvents } from "@/lib/today";
import { experimentLifecycle } from "@/lib/execution";
import type { Experiment, WorkspaceState } from "@/lib/types";

/** Everything that happened, newest first — a projection, not new storage. */
export function TimelineTab({
  workspace,
  activeExperiment,
}: {
  workspace: WorkspaceState;
  activeExperiment?: Experiment;
}) {
  const events = timelineEvents(workspace);
  if (events.length === 0) {
    return (
      <Card className="p-6 text-sm text-neutral-500">
        Nothing yet — publish your first planned post from Today and the timeline starts
        itself.
      </Card>
    );
  }
  const lifecycle = activeExperiment
    ? experimentLifecycle(activeExperiment, new Date())
    : undefined;
  return (
    <section className="space-y-4">
      {activeExperiment && lifecycle && (
        <Card className="border-accent-800/70 bg-accent-950/20 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-accent-300">
                Current experiment · {activeExperiment.platformName}
              </div>
              <h2 className="mt-1 text-lg font-semibold">{lifecycle.headline}</h2>
              <p className="mt-1 text-xs text-neutral-400">{lifecycle.detail}</p>
            </div>
            <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-neutral-400">
              {activeExperiment.status}
            </span>
          </div>
          <div className="mt-4">
            <ExecutionProgress steps={lifecycle.steps} />
          </div>
        </Card>
      )}

      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold">What changed</h2>
        <ol className="relative space-y-3 border-l border-line pl-5">
          {events.map((e, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[1.42rem] top-1.5 h-2 w-2 rounded-full bg-accent-500" />
              <div className="text-sm text-neutral-200">
                <span className="mr-1.5">{e.icon}</span>
                {e.text}
              </div>
              <div className="text-[11px] text-neutral-600">
                {new Date(e.at).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}
