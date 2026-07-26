import { afterEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { GET as metricsRoute } from "@/app/api/metrics/route";
import { buildProductMetrics, type ProductMetricRows } from "@/lib/productMetrics";

function fixture(): ProductMetricRows {
  return {
    projects: [
      { id: "project-1", user_id: "user-1", updated_at: "2026-07-21T12:00:00.000Z" },
      { id: "project-2", user_id: "user-2", updated_at: "2026-07-14T12:00:00.000Z" },
      { id: "project-3", user_id: "user-3", updated_at: "2026-07-22T12:00:00.000Z" },
    ],
    generatedPlans: [
      { id: "project-1", user_id: "user-1" },
      { id: "project-2", user_id: "user-2" },
    ],
    campaigns: [
      { id: "campaign-1", user_id: "user-1", updated_at: "2026-07-15T12:00:00.000Z" },
      { id: "campaign-2", user_id: "user-2", updated_at: "2026-07-15T12:00:00.000Z" },
    ],
    experiments: [
      {
        id: "experiment-1",
        user_id: "user-1",
        status: "analyzed",
        published_at: "2026-07-20T12:00:00.000Z",
      },
      {
        id: "experiment-2",
        user_id: "user-2",
        status: "live",
        published_at: "2026-07-16T12:00:00.000Z",
      },
      {
        id: "experiment-3",
        user_id: "user-3",
        status: "analyzed",
        published_at: "2026-07-22T12:00:00.000Z",
      },
    ],
    outcomes: [
      {
        id: "outcome-1",
        experiment_id: "experiment-1",
        user_id: "user-1",
        checkpoint: "24h",
        recorded_at: "2026-07-21T12:00:00.000Z",
      },
      {
        id: "outcome-2",
        experiment_id: "experiment-3",
        user_id: "user-3",
        checkpoint: "manual",
        recorded_at: "2026-07-23T12:00:00.000Z",
      },
    ],
    tasks: [],
  };
}

describe("product funnel and weekly retention", () => {
  it("counts the real lifecycle and excludes manual early reads from completed loops", () => {
    const metrics = buildProductMetrics(fixture(), new Date("2026-07-25T00:00:00.000Z"));
    expect(metrics.funnel).toMatchObject({
      savedProjectUsers: 3,
      generatedPlanUsers: 2,
      publishedUsers: 3,
      measuredUsers: 2,
      completedLoopUsers: 1,
      learningLoopsCompleted: 1,
      conversion: {
        savedToPlan: 0.6667,
        planToPublish: 1,
        publishToMeasure: 0.6667,
        measureToLoop: 0.5,
      },
    });
    expect(metrics.retention).toMatchObject({
      retainedUsers: 1,
      weeklyRetentionRate: 0.5,
      currentCompletedLoops: 1,
      previousCompletedLoops: 0,
      evidence: "directional",
    });
    expect(metrics.retention.currentWindow.activeUsers).toBe(2);
    expect(metrics.retention.previousWindow.activeUsers).toBe(2);
  });

  it("reports no baseline instead of inventing a retention percentage", () => {
    const metrics = buildProductMetrics(
      {
        projects: [],
        generatedPlans: [],
        campaigns: [],
        experiments: [],
        outcomes: [],
        tasks: [],
      },
      new Date("2026-07-25T00:00:00.000Z")
    );
    expect(metrics.retention.weeklyRetentionRate).toBeNull();
    expect(metrics.retention.evidence).toBe("no-baseline");
    expect(metrics.funnel.conversion.savedToPlan).toBeNull();
  });

  it("never returns raw identities or submitted values", () => {
    const output = JSON.stringify(
      buildProductMetrics(fixture(), new Date("2026-07-25T00:00:00.000Z"))
    );
    expect(output).not.toContain("user-1");
    expect(output).not.toContain("experiment-1");
    expect(output).not.toContain("outcome-1");
    expect(JSON.parse(output).privacy).toEqual({
      aggregateOnly: true,
      containsUserIds: false,
      containsSubmittedContent: false,
      containsOutcomeValues: false,
    });
  });
});

function req(auth?: string): NextRequest {
  return new Request("http://localhost/api/metrics", {
    headers: auth ? { authorization: auth } : {},
  }) as unknown as NextRequest;
}

const savedSecret = process.env.CRON_SECRET;
afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
});

describe("/api/metrics operator boundary", () => {
  it("fails closed without an operator secret", async () => {
    delete process.env.CRON_SECRET;
    const response = await metricsRoute(req("Bearer anything"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a missing or incorrect bearer", async () => {
    process.env.CRON_SECRET = "operator-secret";
    expect((await metricsRoute(req())).status).toBe(401);
    expect((await metricsRoute(req("Bearer incorrect"))).status).toBe(401);
  });
});
