import { describe, expect, it } from "vitest";
import {
  experimentLifecycle,
  formatCountdown,
  latestRelevantExperiment,
  publishDestination,
} from "@/lib/execution";
import type { Experiment, Outcome, WorkspaceState } from "@/lib/types";

const NOW = new Date("2026-07-14T12:00:00Z");
const hoursBefore = (hours: number) =>
  new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const outcome = (checkpoint: "24h" | "72h"): Outcome => ({
  id: `outcome-${checkpoint}`,
  checkpoint,
  recordedAt: NOW.toISOString(),
  replies: 3,
});

const experiment = (over: Partial<Experiment> = {}): Experiment => ({
  id: "exp-1",
  platformId: "reddit",
  platformName: "Reddit",
  community: "r/test",
  angle: "the angle",
  variant: "the hook",
  hypothesis: "replies within 72h",
  publishedAt: hoursBefore(2),
  status: "live",
  postIdx: 0,
  outcomes: [],
  ...over,
});

describe("M19 experiment lifecycle projection", () => {
  it("shows a visible 24h countdown after publication", () => {
    const lifecycle = experimentLifecycle(experiment(), NOW);
    expect(lifecycle.nextCheckpoint).toBe("24h");
    expect(lifecycle.due).toBe(false);
    expect(lifecycle.headline).toContain("22h");
    expect(lifecycle.steps.map((step) => [step.id, step.done])).toEqual([
      ["prepare", true],
      ["publish", true],
      ["measure", false],
      ["learn", false],
    ]);
  });

  it("turns the 24h checkpoint into an immediate action when due", () => {
    const lifecycle = experimentLifecycle(
      experiment({ publishedAt: hoursBefore(25) }),
      NOW
    );
    expect(lifecycle.due).toBe(true);
    expect(lifecycle.nextCheckpoint).toBe("24h");
    expect(lifecycle.headline).toContain("ready");
  });

  it("keeps the early read visible while counting down to the final 72h check", () => {
    const lifecycle = experimentLifecycle(
      experiment({
        publishedAt: hoursBefore(30),
        outcomes: [outcome("24h")],
        status: "analyzed",
        verdict: {
          call: "promising",
          reason: "people replied",
          advice: "keep the angle",
          decidedAt: NOW.toISOString(),
        },
      }),
      NOW
    );
    expect(lifecycle.nextCheckpoint).toBe("72h");
    expect(lifecycle.headline).toContain("Early read captured");
    expect(lifecycle.steps.find((step) => step.id === "learn")?.done).toBe(true);
  });

  it("shows a manual signal without falsely completing the Learn step", () => {
    const lifecycle = experimentLifecycle(
      experiment({
        outcomes: [{ ...outcome("24h"), checkpoint: "manual" }],
        verdict: {
          call: "promising",
          reason: "early replies",
          advice: "wait for 24h",
          decidedAt: NOW.toISOString(),
        },
      }),
      NOW
    );
    expect(lifecycle.headline).toContain("Early read saved");
    expect(lifecycle.nextCheckpoint).toBe("24h");
    expect(lifecycle.steps.find((step) => step.id === "measure")?.done).toBe(false);
    expect(lifecycle.steps.find((step) => step.id === "learn")?.done).toBe(false);
  });

  it("marks the lifecycle complete after the final result", () => {
    const lifecycle = experimentLifecycle(
      experiment({ outcomes: [outcome("24h"), outcome("72h")] }),
      NOW
    );
    expect(lifecycle.complete).toBe(true);
    expect(lifecycle.headline).toBe("Experiment complete");
  });

  it("selects the latest unfinished experiment for visible follow-up", () => {
    const workspace: WorkspaceState = {
      taskLog: [],
      experiments: [
        experiment({ id: "complete", outcomes: [outcome("72h")] }),
        experiment({ id: "active", publishedAt: hoursBefore(1) }),
      ],
    };
    expect(latestRelevantExperiment(workspace)?.id).toBe("active");
  });

  it("keeps countdowns and platform destinations deterministic", () => {
    expect(formatCountdown(90 * 60_000)).toBe("1h 30m");
    expect(formatCountdown(0)).toBe("due now");
    expect(publishDestination("reddit")).toBe("https://www.reddit.com/submit");
    expect(publishDestination("unknown")).toBeUndefined();
  });
});
