import type {
  Experiment,
  ExperimentVerdict,
  Outcome,
  OutcomeCheckpoint,
  WorkspaceState,
} from "./types";
import { normalizeSuccessContract } from "./successContract";

/** A verdict belongs to the checkpoint that produced it. Experiment.verdict
 * remains a materialized latest/final summary for backwards compatibility. */
export function outcomeVerdict(
  experiment: Experiment,
  checkpoint?: OutcomeCheckpoint
): { outcome: Outcome; verdict: ExperimentVerdict } | undefined {
  const outcome = [...experiment.outcomes]
    .reverse()
    .find(
      (outcome): outcome is Outcome & { verdict: ExperimentVerdict } =>
        Boolean(outcome.verdict) &&
        (checkpoint === undefined || outcome.checkpoint === checkpoint)
    );
  return outcome ? { outcome, verdict: outcome.verdict } : undefined;
}

/** The current read used by the workbench. New data is sourced from Outcome;
 * the experiment-level fallback keeps historical projects usable. */
export function effectiveExperimentVerdict(
  experiment: Experiment
): ExperimentVerdict | undefined {
  return outcomeVerdict(experiment)?.verdict ?? experiment.verdict;
}

/** True when only the old experiment-level final read survived. */
export function hasHistoricalFinalVerdict(experiment: Experiment): boolean {
  return (
    Boolean(experiment.verdict) && !experiment.outcomes.some((outcome) => outcome.verdict)
  );
}

/** A completed loop needs a scheduled checkpoint. Old projects may only have
 * one final experiment-level verdict; it still counts, but is never attached
 * to a specific historical checkpoint in the Timeline. */
export function completedScheduledVerdict(
  experiment: Experiment
): ExperimentVerdict | undefined {
  const scheduled = [...experiment.outcomes]
    .reverse()
    .find(
      (outcome): outcome is Outcome & { verdict: ExperimentVerdict } =>
        outcome.checkpoint !== "manual" && Boolean(outcome.verdict)
    );
  if (scheduled) return scheduled.verdict;
  const hasScheduled = experiment.outcomes.some(
    (outcome) => outcome.checkpoint === "24h" || outcome.checkpoint === "72h"
  );
  return hasScheduled ? experiment.verdict : undefined;
}

/** Explicit v7 compatibility migration. It never fabricates checkpoint
 * history: an old experiment-level verdict stays at experiment level and is
 * rendered as a historical final verdict. If checkpoint verdicts already
 * exist, the latest one repairs the materialized summary deterministically. */
export function migrateWorkspaceHistory(workspace: WorkspaceState): WorkspaceState {
  const successContract = normalizeSuccessContract(workspace.successContract);
  return {
    ...workspace,
    ...(successContract ? { successContract } : { successContract: undefined }),
    experiments: workspace.experiments.map((experiment) => {
      const experimentContract = normalizeSuccessContract(experiment.successContract);
      const normalized = {
        ...experiment,
        outcomes: Array.isArray(experiment.outcomes) ? experiment.outcomes : [],
        ...(experimentContract
          ? { successContract: experimentContract }
          : { successContract: undefined }),
      };
      const latest = outcomeVerdict(normalized)?.verdict;
      return latest && experiment.verdict !== latest
        ? { ...normalized, verdict: latest }
        : normalized;
    }),
  };
}
