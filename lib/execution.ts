import type { Experiment, OutcomeCheckpoint, WorkspaceState } from "./types";

const HOUR = 3_600_000;

export type ExecutionStepId = "prepare" | "publish" | "measure" | "learn";

export interface ExecutionStep {
  id: ExecutionStepId;
  label: string;
  done: boolean;
  active: boolean;
}

export interface ExperimentLifecycle {
  steps: ExecutionStep[];
  headline: string;
  detail: string;
  nextCheckpoint?: Extract<OutcomeCheckpoint, "24h" | "72h">;
  dueAt?: string;
  due: boolean;
  complete: boolean;
  countdown?: string;
}

const stepsFor = (
  measure: boolean,
  learn: boolean,
  active: ExecutionStepId
): ExecutionStep[] =>
  (["prepare", "publish", "measure", "learn"] as const).map((id) => ({
    id,
    label: id[0].toUpperCase() + id.slice(1),
    done:
      id === "prepare" ||
      id === "publish" ||
      (id === "measure" && measure) ||
      (id === "learn" && learn),
    active: id === active,
  }));

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "due now";
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
  if (hours > 0) return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Pure projection of one manually published experiment into visible workbench state. */
export function experimentLifecycle(exp: Experiment, now: Date): ExperimentLifecycle {
  const published = new Date(exp.publishedAt).getTime();
  const has24 = exp.outcomes.some((outcome) => outcome.checkpoint === "24h");
  const has72 = exp.outcomes.some((outcome) => outcome.checkpoint === "72h");
  const hasEarly = exp.outcomes.some((outcome) => outcome.checkpoint === "manual");
  const measured = has24 || has72;
  const learned = Boolean(exp.verdict) && (has24 || has72);

  if (exp.status === "stopped") {
    return {
      steps: stepsFor(measured, learned, "learn"),
      headline: "Experiment stopped",
      detail: exp.verdict?.reason ?? "This channel experiment was stopped.",
      due: false,
      complete: true,
    };
  }

  if (has72) {
    return {
      steps: stepsFor(true, learned, "learn"),
      headline: "Experiment complete",
      detail: exp.verdict?.reason ?? "The final 72h result is recorded.",
      due: false,
      complete: true,
    };
  }

  const checkpoint: "24h" | "72h" = has24 ? "72h" : "24h";
  const hours = checkpoint === "24h" ? 24 : 72;
  const dueAtMs = published + hours * HOUR;
  const remaining = dueAtMs - now.getTime();
  const due = remaining <= 0;

  return {
    steps: stepsFor(measured, learned, due ? "measure" : learned ? "learn" : "measure"),
    headline: due
      ? `${checkpoint} result check is ready`
      : hasEarly && !has24
        ? `Early read saved · ${checkpoint} check in ${formatCountdown(remaining)}`
        : learned
          ? `Early read captured · final ${checkpoint} check in ${formatCountdown(remaining)}`
          : `${checkpoint} result check in ${formatCountdown(remaining)}`,
    detail: due
      ? "Record what happened. Missing metrics can stay blank."
      : hasEarly && !has24
        ? `${exp.verdict?.advice ?? "The early signal is saved."} The scheduled check remains open.`
        : learned
          ? (exp.verdict?.advice ??
            "The early result is saved; the final read will refine it.")
          : "The post is live. PostBeacon is waiting for a useful signal window instead of guessing early.",
    nextCheckpoint: checkpoint,
    dueAt: new Date(dueAtMs).toISOString(),
    due,
    complete: false,
    countdown: formatCountdown(remaining),
  };
}

/** Latest experiment that still has a useful next event; otherwise the latest experiment. */
export function latestRelevantExperiment(
  workspace: WorkspaceState
): Experiment | undefined {
  const ordered = [...workspace.experiments].sort((a, b) =>
    a.publishedAt < b.publishedAt ? 1 : -1
  );
  return (
    ordered.find(
      (experiment) =>
        experiment.status !== "stopped" &&
        !experiment.outcomes.some((outcome) => outcome.checkpoint === "72h")
    ) ?? ordered[0]
  );
}

/** Known, operator-controlled destinations only. The app still never posts. */
const PUBLISH_DESTINATIONS: Record<string, string> = {
  reddit: "https://www.reddit.com/submit",
  twitter: "https://x.com/compose/post",
  linkedin: "https://www.linkedin.com/feed/",
  github: "https://github.com/new",
  hackernews: "https://news.ycombinator.com/submit",
  producthunt: "https://www.producthunt.com/posts/new",
  indiehackers: "https://www.indiehackers.com/post",
  devto: "https://dev.to/new",
  medium: "https://medium.com/new-story",
};

export function publishDestination(platformId: string): string | undefined {
  return PUBLISH_DESTINATIONS[platformId];
}
