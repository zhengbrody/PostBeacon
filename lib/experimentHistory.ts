import type {
  Experiment,
  ExperimentVerdict,
  Outcome,
  OutcomeCheckpoint,
  WorkspaceState,
} from "./types";
import { normalizeSuccessContract, OUTCOME_METRICS } from "./successContract";
import { asRecord, asRecordList, asString } from "./coerce";
import {
  normalizeOpportunityResearch,
  normalizeTrialSnapshot,
} from "./opportunityResearch";

/** Missing/null/non-numeric observations remain unknown after hydration. */
export function normalizeOutcome(value: unknown): Outcome | undefined {
  const item = asRecord(value);
  const checkpoint = asString(item.checkpoint);
  if (!asString(item.id) || !["24h", "72h", "manual"].includes(checkpoint))
    return undefined;
  const invalidatedReason = [
    "post-removed",
    "tracking-broken",
    "wrong-audience",
    "external-event",
    "other",
  ].includes(asString(item.invalidatedReason))
    ? (item.invalidatedReason as Outcome["invalidatedReason"])
    : undefined;
  const unavailableMetrics = Array.isArray(item.unavailableMetrics)
    ? OUTCOME_METRICS.filter(
        (metric) =>
          item.unavailableMetrics instanceof Array &&
          item.unavailableMetrics.includes(metric)
      )
    : [];
  const observations = Object.fromEntries(
    OUTCOME_METRICS.flatMap((metric) =>
      typeof item[metric] === "number" &&
      Number.isFinite(item[metric]) &&
      item[metric] >= 0 &&
      !unavailableMetrics.includes(metric)
        ? [[metric, Math.min(item[metric], 1_000_000_000)]]
        : []
    )
  );
  const verdict = asRecord(item.verdict);
  const hasVerdict = ["supported", "promising", "weak", "no-signal"].includes(
    asString(verdict.call)
  );
  return {
    id: asString(item.id).slice(0, 80),
    checkpoint: checkpoint as OutcomeCheckpoint,
    recordedAt: asString(item.recordedAt).slice(0, 40),
    ...observations,
    ...(unavailableMetrics.length ? { unavailableMetrics } : {}),
    ...(invalidatedReason ? { invalidatedReason } : {}),
    qualitativeFeedback: asString(item.qualitativeFeedback).slice(0, 6000) || undefined,
    ...(hasVerdict
      ? {
          verdict: {
            call: verdict.call as ExperimentVerdict["call"],
            reason: asString(verdict.reason).slice(0, 2000),
            advice: asString(verdict.advice).slice(0, 2000),
            decidedAt: asString(verdict.decidedAt).slice(0, 40),
            ...([
              "target-reached",
              "improved",
              "early",
              "target-missed",
              "insufficient",
              "invalidated",
            ].includes(asString(verdict.assessment))
              ? { assessment: verdict.assessment as ExperimentVerdict["assessment"] }
              : {}),
          },
        }
      : {}),
  };
}
import { normalizePlannedExperiments, normalizePublishSnapshot } from "./experimentQueue";

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
  if (
    experiment.outcomes.some(
      (item) => item.invalidatedReason || item.verdict?.assessment === "invalidated"
    )
  )
    return undefined;
  const scheduled = [...experiment.outcomes]
    .reverse()
    .find(
      (outcome): outcome is Outcome & { verdict: ExperimentVerdict } =>
        outcome.checkpoint !== "manual" &&
        Boolean(outcome.verdict) &&
        outcome.verdict?.assessment !== "insufficient" &&
        outcome.verdict?.assessment !== "invalidated" &&
        !outcome.invalidatedReason
    );
  if (scheduled) return scheduled.verdict;
  const hasScheduled = experiment.outcomes.some(
    (outcome) => outcome.checkpoint === "24h" || outcome.checkpoint === "72h"
  );
  return hasScheduled && !experiment.outcomes.some((item) => item.verdict)
    ? experiment.verdict
    : undefined;
}

/** Explicit v7 compatibility migration. It never fabricates checkpoint
 * history: an old experiment-level verdict stays at experiment level and is
 * rendered as a historical final verdict. If checkpoint verdicts already
 * exist, the latest one repairs the materialized summary deterministically. */
export function migrateWorkspaceHistory(workspace: WorkspaceState): WorkspaceState {
  const successContract = normalizeSuccessContract(workspace.successContract);
  return {
    ...workspace,
    opportunityResearch: normalizeOpportunityResearch(workspace.opportunityResearch),
    ...(workspace.plannedExperiments
      ? { plannedExperiments: normalizePlannedExperiments(workspace.plannedExperiments) }
      : {}),
    ...(successContract ? { successContract } : { successContract: undefined }),
    experiments: workspace.experiments.map((experiment) => {
      const experimentContract = normalizeSuccessContract(experiment.successContract);
      const normalized = {
        ...experiment,
        opportunity: normalizeTrialSnapshot(experiment.opportunity),
        outcomes: asRecordList(experiment.outcomes).flatMap((item) => {
          const outcome = normalizeOutcome(item);
          return outcome ? [outcome] : [];
        }),
        ...(experiment.snapshot
          ? { snapshot: normalizePublishSnapshot(experiment.snapshot) }
          : {}),
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
