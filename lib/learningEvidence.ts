import {
  OUTCOME_METRICS,
  isFinalContractCheckpoint,
  outcomeSignal,
} from "./successContract";
import type {
  AngleRecord,
  Experiment,
  Outcome,
  ProductMemory,
  WorkspaceState,
} from "./types";

/** Unknown observations are not negative evidence. Invalid tests stay in history. */
export function measuredOutcome(outcome: Outcome): boolean {
  return (
    !outcome.invalidatedReason &&
    OUTCOME_METRICS.some((metric) => outcomeSignal(outcome, metric) !== undefined)
  );
}

export function deriveAngleEvidence(workspace: WorkspaceState): AngleRecord[] {
  const comparisonKeys = new Map(
    workspace.experiments.map((experiment) => [
      experiment.id,
      !experiment.snapshot
        ? experiment.id
        : JSON.stringify([
            experiment.platformId,
            experiment.community ?? "",
            experiment.angle,
            experiment.successContract,
            experiment.snapshot.audience,
            experiment.snapshot.publisherVoice,
            experiment.snapshot.facts
              .map(({ id, claim, status }) => ({ id, claim, status }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          ]),
    ])
  );
  const reads = workspace.experiments.flatMap((experiment) => {
    if (
      experiment.outcomes.some(
        (item) => item.invalidatedReason || item.verdict?.assessment === "invalidated"
      )
    )
      return [];
    const outcome = [...experiment.outcomes]
      .reverse()
      .find(
        (item) =>
          item.checkpoint !== "manual" &&
          measuredOutcome(item) &&
          (!experiment.successContract ||
            isFinalContractCheckpoint(
              item.checkpoint,
              experiment.successContract.evaluationWindow
            ))
      );
    const verdict = outcome?.verdict;
    if (
      !outcome ||
      !verdict ||
      verdict.assessment === "insufficient" ||
      verdict.assessment === "invalidated"
    )
      return [];
    // Legacy threshold reads are retained in history, not promoted to new learning.
    if (!verdict.assessment) return [];
    const direction: AngleRecord["verdict"] =
      verdict.assessment === "target-reached"
        ? "winning"
        : verdict.assessment === "target-missed"
          ? "losing"
          : "inconclusive";
    return [
      {
        angle: experiment.angle,
        platformId: experiment.platformId,
        verdict: direction,
        experimentId: experiment.id,
        outcomeId: outcome.id,
        at: outcome.recordedAt,
      },
    ];
  });
  const groups = new Map<
    string,
    {
      count: number;
      all: Set<AngleRecord["verdict"]>;
      directional: Set<AngleRecord["verdict"]>;
    }
  >();
  for (const read of reads) {
    const key = comparisonKeys.get(read.experimentId)!;
    const group = groups.get(key) ?? { count: 0, all: new Set(), directional: new Set() };
    group.count++;
    group.all.add(read.verdict);
    if (read.verdict !== "inconclusive") group.directional.add(read.verdict);
    groups.set(key, group);
  }
  return reads
    .map((read) => {
      const group = groups.get(comparisonKeys.get(read.experimentId)!)!;
      const evidenceState: AngleRecord["evidenceState"] =
        group.directional.size > 1
          ? "conflicting evidence"
          : group.count > 1 && group.all.size === 1
            ? "repeated evidence"
            : "early evidence";
      return { ...read, evidenceState };
    })
    .slice(-20);
}

export function refreshLearningMemory(
  memory: ProductMemory,
  workspace: WorkspaceState
): ProductMemory {
  return { ...memory, angles: deriveAngleEvidence(workspace) };
}

/** 72h is cumulative. Show subtraction only when both values were observed. */
export function checkpointDeltas(
  experiment: Experiment,
  outcome: Outcome
): { metric: (typeof OUTCOME_METRICS)[number]; delta: number }[] {
  if (outcome.checkpoint !== "72h" || outcome.invalidatedReason) return [];
  const previous = [...experiment.outcomes]
    .reverse()
    .find((item) => item.checkpoint === "24h" && !item.invalidatedReason);
  if (!previous) return [];
  return OUTCOME_METRICS.flatMap((metric) => {
    const before = outcomeSignal(previous, metric),
      after = outcomeSignal(outcome, metric);
    return before === undefined || after === undefined
      ? []
      : [{ metric, delta: after - before }];
  });
}
