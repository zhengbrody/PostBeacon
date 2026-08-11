import { describe, expect, it } from "vitest";
import {
  effortEstimate,
  observableSignal,
  rankComparison,
  rankRecommendations,
  recommendedPlatformId,
} from "@/lib/strategyDecision";
import type { PlatformRecommendation, ScoreBreakdown } from "@/lib/types";

const breakdown = (audienceFit: number): ScoreBreakdown => ({
  audienceFit: { score: audienceFit, reason: "audience" },
  intentFit: { score: 7, reason: "intent" },
  nativeContentFit: { score: 7, reason: "content" },
  founderAccess: { score: 6, reason: "access" },
  effort: { score: 5, reason: "effort" },
  risk: { score: 4, reason: "risk" },
  evidenceQuality: { score: 8, reason: "evidence" },
});

const rec = (
  platformId: string,
  score: number,
  audienceFit = 7
): PlatformRecommendation => ({
  platformId,
  platformName: platformId,
  score,
  priority: "high",
  effort: "medium",
  rationale: "why",
  angle: "angle",
  breakdown: breakdown(audienceFit),
});

describe("focused strategy decision", () => {
  it("ranks by computed score and breaks ties by catalog order", () => {
    const ranked = rankRecommendations([
      rec("reddit", 80),
      rec("twitter", 80),
      rec("github", 80),
    ]);
    expect(ranked.map((item) => item.platformId)).toEqual(["github", "twitter", "reddit"]);
    expect(recommendedPlatformId(ranked)).toBe("github");
  });

  it("explains why the recommended channel beats the runner-up", () => {
    const top = rec("twitter", 82, 9);
    const second = rec("reddit", 76, 6);
    expect(rankComparison(top, [second, top])).toContain(
      "led by audience fit (9/10 vs 6/10)"
    );
  });

  it("does not pretend a manually chosen alternative is still #1", () => {
    const top = rec("twitter", 82);
    const second = rec("reddit", 76);
    expect(rankComparison(second, [top, second])).toContain(
      "reddit is ranked #2. twitter remains #1 by 6 points"
    );
  });

  it("labels estimates and legacy plans honestly", () => {
    expect(effortEstimate(rec("twitter", 82))).toContain("planning estimate");
    expect(observableSignal()).toContain("legacy plan");
    expect(
      observableSignal({
        primaryGoal: "Qualified traffic",
        primarySignal: "clicks",
        minimumResult: 10,
        evaluationWindow: "72h",
      })
    ).toBe("Qualified visits / clicks ≥ 10 by 72h");
  });
});
