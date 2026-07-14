import { describe, expect, it } from "vitest";
import { growthMode, recommendedPrimaryGoal } from "@/lib/growth";
import type { Experiment, WorkspaceState } from "@/lib/types";

const experiment: Experiment = {
  id: "e1",
  platformId: "reddit",
  platformName: "Reddit",
  community: "r/test",
  angle: "show the pain",
  variant: "A",
  hypothesis: "Replies within 72h",
  publishedAt: "2026-07-14T00:00:00Z",
  status: "live",
  postIdx: 0,
  outcomes: [],
};

const workspace = (experiments: Experiment[] = []): WorkspaceState => ({
  experiments,
  taskLog: [],
});

describe("M18 lifecycle", () => {
  it("moves automatically from launch to growth after the first measured publish", () => {
    expect(growthMode(workspace())).toBe("launch");
    expect(growthMode(workspace([experiment]))).toBe("growth");
  });

  it("turns help-me-decide into a concrete stage-aware goal", () => {
    expect(recommendedPrimaryGoal("Pre-launch — no users yet")).toBe("Waitlist signups");
    expect(recommendedPrimaryGoal("Just launched — first users trickling in")).toBe(
      "Free signups / installs"
    );
    expect(recommendedPrimaryGoal("Growing — steady signups")).toBe("Paying customers");
    expect(recommendedPrimaryGoal()).toBe("User feedback / conversations");
  });
});
