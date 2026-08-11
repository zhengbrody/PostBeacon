import { asRecord, asString } from "./coerce";
import type { Outcome, OutcomeMetric, SuccessContract, SuccessWindow } from "./types";

export const OUTCOME_METRICS: OutcomeMetric[] = [
  "impressions",
  "replies",
  "clicks",
  "signups",
  "revenue",
];

export const SIGNAL_LABELS: Record<OutcomeMetric, string> = {
  impressions: "Qualified impressions",
  replies: "Qualified replies / conversations",
  clicks: "Qualified visits / clicks",
  signups: "Signups / installs",
  revenue: "Revenue ($)",
};

const WINDOWS = new Set<SuccessWindow>(["24h", "72h"]);
const METRICS = new Set<OutcomeMetric>(OUTCOME_METRICS);

function boundedNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  return Math.min(number, 1_000_000_000);
}

/** Stage-aware defaults only seed the form. They are visible and editable;
 * they never become a verdict until the founder confirms the contract. */
export function defaultSuccessContract(primaryGoal: string): SuccessContract {
  const goal = primaryGoal.trim() || "User feedback / conversations";
  const normalized = goal.toLowerCase();
  if (normalized.includes("paying") || normalized.includes("revenue")) {
    return {
      primaryGoal: goal,
      primarySignal: "revenue",
      minimumResult: 1,
      evaluationWindow: "72h",
    };
  }
  if (
    normalized.includes("waitlist") ||
    normalized.includes("signup") ||
    normalized.includes("install")
  ) {
    return {
      primaryGoal: goal,
      primarySignal: "signups",
      minimumResult: 1,
      evaluationWindow: "72h",
    };
  }
  if (
    normalized.includes("traffic") ||
    normalized.includes("awareness") ||
    normalized.includes("visit")
  ) {
    return {
      primaryGoal: goal,
      primarySignal: "clicks",
      minimumResult: 10,
      evaluationWindow: "72h",
    };
  }
  return {
    primaryGoal: goal,
    primarySignal: "replies",
    minimumResult: 2,
    evaluationWindow: "72h",
  };
}

/** Persisted projects and API bodies are untrusted JSON. Reject malformed
 * contracts instead of allowing NaN/negative targets to drive decisions. */
export function normalizeSuccessContract(value: unknown): SuccessContract | null {
  const root = asRecord(value);
  const primaryGoal = asString(root.primaryGoal).trim().slice(0, 500);
  const primarySignal = asString(root.primarySignal) as OutcomeMetric;
  const evaluationWindow = asString(root.evaluationWindow) as SuccessWindow;
  const minimumResult = boundedNumber(root.minimumResult);
  const baseline = boundedNumber(root.baseline);
  if (
    !primaryGoal ||
    !METRICS.has(primarySignal) ||
    !WINDOWS.has(evaluationWindow) ||
    minimumResult === undefined ||
    minimumResult <= 0
  ) {
    return null;
  }
  return {
    primaryGoal,
    primarySignal,
    minimumResult,
    evaluationWindow,
    ...(baseline === undefined ? {} : { baseline }),
  };
}

export function successContractSummary(contract: SuccessContract): string {
  const unit = contract.primarySignal === "revenue" ? "$" : "";
  return `${SIGNAL_LABELS[contract.primarySignal]} ≥ ${unit}${contract.minimumResult} by ${contract.evaluationWindow}`;
}

export function outcomeSignal(outcome: Outcome, signal: OutcomeMetric): number | undefined {
  const value = outcome[signal];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function isFinalContractCheckpoint(
  checkpoint: Outcome["checkpoint"],
  window: SuccessWindow
): boolean {
  if (checkpoint === "manual") return false;
  return window === "24h" || checkpoint === "72h";
}
