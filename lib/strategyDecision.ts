import { PLATFORMS } from "./platforms";
import type { PlatformRecommendation, ScoreDimensionKey, SuccessContract } from "./types";
import { successContractSummary } from "./successContract";

const catalogRank = new Map(PLATFORMS.map((platform, index) => [platform.id, index]));

const DIMENSION_LABELS: Record<ScoreDimensionKey, string> = {
  audienceFit: "audience fit",
  intentFit: "intent fit",
  nativeContentFit: "native content fit",
  founderAccess: "founder access",
  effort: "effort",
  risk: "risk",
  evidenceQuality: "evidence quality",
};

const INVERTED_DIMENSIONS = new Set<ScoreDimensionKey>(["effort", "risk"]);

/**
 * Strategy decisions must not depend on whatever order a model happened to
 * return. Score wins first; catalog order is the deterministic tie-breaker.
 */
export function rankRecommendations(
  recommendations: PlatformRecommendation[]
): PlatformRecommendation[] {
  return [...recommendations].sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta) return scoreDelta;
    const catalogDelta =
      (catalogRank.get(a.platformId) ?? Number.MAX_SAFE_INTEGER) -
      (catalogRank.get(b.platformId) ?? Number.MAX_SAFE_INTEGER);
    return catalogDelta || a.platformId.localeCompare(b.platformId);
  });
}

export function recommendedPlatformId(
  recommendations?: PlatformRecommendation[]
): string | undefined {
  return recommendations?.length
    ? rankRecommendations(recommendations)[0]?.platformId
    : undefined;
}

export function effortEstimate(rec: PlatformRecommendation): string {
  switch (rec.effort) {
    case "low":
      return "30–45 min planning estimate";
    case "high":
      return "90–150 min planning estimate";
    default:
      return "45–90 min planning estimate";
  }
}

export function observableSignal(contract?: SuccessContract): string {
  return contract
    ? successContractSummary(contract)
    : "No Success Contract is stored for this legacy plan.";
}

/** Explain the selected rank without manufacturing confidence or causal claims. */
export function rankComparison(
  selected: PlatformRecommendation,
  recommendations: PlatformRecommendation[]
): string {
  const ranked = rankRecommendations(recommendations);
  const selectedRank = ranked.findIndex((rec) => rec.platformId === selected.platformId);
  if (selectedRank < 0) return "This channel is not part of the ranked strategy.";
  const top = ranked[0];
  if (!top) return "No ranked comparison is available.";
  if (selectedRank > 0) {
    return `${selected.platformName} is ranked #${selectedRank + 1}. ${top.platformName} remains #1 by ${Math.max(0, top.score - selected.score)} points; choose this alternative only when its venue or workflow fits a real constraint better.`;
  }

  const runnerUp = ranked[1];
  if (!runnerUp) return "This is the only ranked channel in the strategy.";
  const lead = Math.max(0, selected.score - runnerUp.score);
  const keys = Object.keys(DIMENSION_LABELS) as ScoreDimensionKey[];
  const strongest =
    selected.breakdown && runnerUp.breakdown
      ? keys
          .map((key) => {
            const selectedScore = selected.breakdown?.[key].score ?? 0;
            const runnerScore = runnerUp.breakdown?.[key].score ?? 0;
            const advantage = INVERTED_DIMENSIONS.has(key)
              ? runnerScore - selectedScore
              : selectedScore - runnerScore;
            return { key, advantage, selectedScore, runnerScore };
          })
          .sort((a, b) => b.advantage - a.advantage)[0]
      : undefined;

  if (!strongest || strongest.advantage <= 0) {
    return `${selected.platformName} ranks ${lead} points above #2 ${runnerUp.platformName} in PostBeacon's deterministic weighted score.`;
  }
  return `${selected.platformName} ranks ${lead} points above #2 ${runnerUp.platformName}, led by ${DIMENSION_LABELS[strongest.key]} (${strongest.selectedScore}/10 vs ${strongest.runnerScore}/10).`;
}
