import { describe, expect, it } from "vitest";
import {
  deriveToday,
  dueCheckpoints,
  timelineEvents,
  verdictFor,
  weeklyReview,
  MAX_TODAY_ACTIONS,
} from "@/lib/today";
import { flowReducer, initialFlowState, type FlowAction } from "@/hooks/launchFlowReducer";
import { PLATFORMS } from "@/lib/platforms";
import type {
  Experiment,
  GenerateResult,
  MarketingStrategy,
  Outcome,
  ProductProfile,
  WorkspaceState,
} from "@/lib/types";

const [P0, P1, P2] = PLATFORMS.map((p) => p.id);
const NOW = new Date("2026-07-12T12:00:00Z");
const hoursBefore = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const post = { hook: "h", body: "b", imageSuggestion: "", bestTime: "", caveats: "" };

const profile: ProductProfile = {
  name: "Acme",
  tagline: "",
  valueProp: "",
  audience: "",
  differentiators: [],
  features: [],
  tone: "",
  category: "tool",
  conversionGoal: "signups",
};

const rec = (platformId: string, score: number, priority: "high" | "low" = "high") => ({
  platformId,
  platformName: platformId,
  score,
  priority,
  rationale: "",
  angle: `angle for ${platformId}`,
  bestMove: `best move on ${platformId}`,
});

const strategy: MarketingStrategy = {
  positioning: "p",
  overallStrategy: "o",
  recommendations: [rec(P0, 90), rec(P1, 80), rec(P2, 70)],
};

const result: GenerateResult = {
  content: [
    { platformId: P0, platformName: P0, posts: [post] },
    { platformId: P1, platformName: P1, posts: [post] },
    { platformId: P2, platformName: P2, posts: [post] },
  ],
  schedule: [
    { day: 1, platformId: P0, platformName: P0, action: "post P0" },
    { day: 2, platformId: P1, platformName: P1, action: "post P1" },
    { day: 9, platformId: P2, platformName: P2, action: "post P2" },
  ],
};

const experiment = (over: Partial<Experiment> = {}): Experiment => ({
  id: "exp-1",
  platformId: P0,
  platformName: P0,
  community: "r/test",
  angle: "the angle",
  variant: "the hook",
  hypothesis: "hyp",
  publishedAt: hoursBefore(30),
  status: "live",
  postIdx: 0,
  outcomes: [],
  ...over,
});

const ws = (over: Partial<WorkspaceState> = {}): WorkspaceState => ({
  experiments: [],
  taskLog: [],
  ...over,
});

const plan = (workspace: WorkspaceState, launchDate = "2026-07-10") => ({
  launchDate,
  strategy,
  result,
  workspace,
});

describe("deriveToday", () => {
  it("never shows more than 3 actions", () => {
    const view = deriveToday(plan(ws()), NOW);
    expect(view.actions.length).toBeLessThanOrEqual(MAX_TODAY_ACTIONS);
  });

  it("due check-ins outrank posting actions", () => {
    const view = deriveToday(plan(ws({ experiments: [experiment()] })), NOW);
    expect(view.actions[0].kind).toBe("record");
    expect(view.actions[0].checkpoint).toBe("24h");
    expect(view.dueRecordCount).toBe(1);
  });

  it("24h and 72h checkpoints come due independently and only once", () => {
    const fresh = experiment({ publishedAt: hoursBefore(2) });
    expect(dueCheckpoints(fresh, NOW)).toEqual([]);
    const after24 = experiment({ publishedAt: hoursBefore(25) });
    expect(dueCheckpoints(after24, NOW)).toEqual(["24h"]);
    const after72 = experiment({ publishedAt: hoursBefore(80) });
    expect(dueCheckpoints(after72, NOW)).toEqual(["24h", "72h"]);
    const recorded24: Outcome = {
      id: "o1",
      checkpoint: "24h",
      recordedAt: hoursBefore(50),
    };
    expect(
      dueCheckpoints(
        experiment({ publishedAt: hoursBefore(80), outcomes: [recorded24] }),
        NOW
      )
    ).toEqual(["72h"]);
    expect(dueCheckpoints(experiment({ status: "stopped" }), NOW)).toEqual([]);
  });

  it("post cards show why-now, estimated minutes, and respect the plan day", () => {
    const view = deriveToday(plan(ws()), NOW); // today = day 3
    const dueTitles = view.actions.filter((a) => a.due).map((a) => a.id);
    expect(dueTitles).toContain(`post:${P0}`); // day 1 ≤ 3
    expect(dueTitles).toContain(`post:${P1}`); // day 2 ≤ 3
    const p2 = view.actions.find((a) => a.id === `post:${P2}`);
    expect(p2?.due).toBe(false); // day 9 — up next, not due
    const p0 = view.actions.find((a) => a.id === `post:${P0}`)!;
    expect(p0.whyNow).toContain("Day 1");
    expect(p0.estMinutes).toBeGreaterThan(0);
  });

  it("skipped and published cards never reappear", () => {
    const view = deriveToday(
      plan(
        ws({
          taskLog: [
            {
              id: `post:${P0}`,
              kind: "post",
              title: "x",
              status: "skipped",
              estMinutes: 0,
              at: NOW.toISOString(),
            },
          ],
          experiments: [
            experiment({ platformId: P1, platformName: P1, publishedAt: hoursBefore(1) }),
          ],
        })
      ),
      NOW
    );
    const ids = view.actions.map((a) => a.id);
    expect(ids).not.toContain(`post:${P0}`); // skipped
    expect(ids).not.toContain(`post:${P1}`); // already published (experiment exists)
  });

  it("all caught up → a single review pointer", () => {
    const done = (id: string) => ({
      id,
      kind: "post" as const,
      title: "x",
      status: "done" as const,
      estMinutes: 0,
      at: NOW.toISOString(),
    });
    const view = deriveToday(
      plan(ws({ taskLog: [done(`post:${P0}`), done(`post:${P1}`), done(`post:${P2}`)] })),
      NOW
    );
    expect(view.actions).toHaveLength(1);
    expect(view.actions[0].kind).toBe("review");
  });

  it("budget line sums only due actions against the weekly budget", () => {
    const view = deriveToday(plan(ws({ weeklyMinutes: 300 })), NOW);
    const dueSum = view.actions.filter((a) => a.due).reduce((n, a) => n + a.estMinutes, 0);
    expect(view.plannedMinutes).toBe(dueSum);
    expect(view.weeklyMinutes).toBe(300);
  });
});

describe("verdictFor (rule-based, absent ≠ 0)", () => {
  const ctx = { platformName: "HN", angle: "the angle", goal: "signups" };
  const outcome = (over: Partial<Outcome>): Outcome => ({
    id: "o",
    checkpoint: "24h",
    recordedAt: NOW.toISOString(),
    ...over,
  });

  it("signups or revenue → supported", () => {
    expect(verdictFor(outcome({ signups: 2 }), ctx).call).toBe("supported");
    expect(verdictFor(outcome({ revenue: 9 }), ctx).call).toBe("supported");
  });
  it("engagement without conversion → promising", () => {
    expect(verdictFor(outcome({ replies: 3 }), ctx).call).toBe("promising");
    expect(verdictFor(outcome({ clicks: 10 }), ctx).call).toBe("promising");
  });
  it("reach without engagement → weak", () => {
    expect(verdictFor(outcome({ impressions: 500, replies: 1 }), ctx).call).toBe("weak");
  });
  it("nothing measured → no-signal with checkpoint-aware advice", () => {
    const v24 = verdictFor(outcome({}), ctx);
    expect(v24.call).toBe("no-signal");
    expect(v24.advice).toMatch(/72h/);
    const v72 = verdictFor(outcome({ checkpoint: "72h" }), ctx);
    expect(v72.advice).toMatch(/stopping/i);
  });
  it("every verdict explains the rule that fired", () => {
    const v = verdictFor(outcome({ signups: 1 }), ctx);
    expect(v.reason.length).toBeGreaterThan(10);
    expect(v.decidedAt).toBeTruthy();
  });
});

describe("weeklyReview — north star = completed learning loops", () => {
  it("counts only verdict-decided loops inside the window", () => {
    const decided = (id: string, at: string): Experiment =>
      experiment({
        id,
        outcomes: [{ id: "o", checkpoint: "24h", recordedAt: at }],
        verdict: { call: "promising", reason: "r", advice: "a", decidedAt: at },
        status: "analyzed",
      });
    const review = weeklyReview(
      {
        strategy,
        workspace: ws({
          experiments: [
            decided("in-week", hoursBefore(24)),
            decided("old", hoursBefore(24 * 10)),
            experiment({ id: "no-loop" }), // published, no outcome → not a loop
          ],
        }),
      },
      NOW
    );
    expect(review.loopsThisWeek).toBe(1);
    expect(review.loops).toHaveLength(2); // all-time list
    expect(review.suggestions.length).toBeLessThanOrEqual(3);
  });

  it("surfaces the top unproven high-priority channel", () => {
    const review = weeklyReview({ strategy, workspace: ws() }, NOW);
    expect(review.suggestions.join(" ")).toContain(P0);
  });
});

describe("reducer workspace transitions", () => {
  const analyzed: FlowAction = { type: "ANALYZED", profile, facts: [], questions: [] };
  const built: FlowAction = { type: "STRATEGY_BUILT", strategy };
  const generated: FlowAction = { type: "GENERATED", result };
  const seq = (...actions: FlowAction[]) => actions.reduce(flowReducer, initialFlowState);

  it("publishing creates the experiment, marks the draft posted, logs the task", () => {
    const s = seq(analyzed, built, generated, {
      type: "EXPERIMENT_CREATED",
      experiment: experiment(),
      taskId: `post:${P0}`,
    });
    expect(s.workspace.experiments).toHaveLength(1);
    expect(s.posted[`${P0}-0`]).toBe(true);
    expect(s.workspace.taskLog.find((t) => t.id === `post:${P0}`)?.status).toBe("done");
  });

  it("recording an outcome computes the verdict atomically", () => {
    const s = seq(
      analyzed,
      built,
      generated,
      { type: "EXPERIMENT_CREATED", experiment: experiment() },
      {
        type: "OUTCOME_RECORDED",
        experimentId: "exp-1",
        outcome: { id: "o1", checkpoint: "24h", recordedAt: NOW.toISOString(), signups: 3 },
      }
    );
    const exp = s.workspace.experiments[0];
    expect(exp.outcomes).toHaveLength(1);
    expect(exp.verdict?.call).toBe("supported");
    expect(exp.status).toBe("analyzed");
  });

  it("a fresh analysis clears the loop history but keeps the weekly budget", () => {
    const s = seq(
      analyzed,
      built,
      generated,
      { type: "WEEKLY_MINUTES_SET", minutes: 300 },
      { type: "EXPERIMENT_CREATED", experiment: experiment() },
      analyzed
    );
    expect(s.workspace.experiments).toEqual([]);
    expect(s.workspace.weeklyMinutes).toBe(300);
  });

  it("hydrates workspace from flat draft or meta, empty for pre-M15 saves", () => {
    const workspace = ws({ experiments: [experiment()] });
    const viaDraft = flowReducer(initialFlowState, {
      type: "PROJECT_LOADED",
      project: { profile, strategy, result, workspace },
      demo: false,
    });
    expect(viaDraft.workspace.experiments).toHaveLength(1);
    const viaMeta = flowReducer(initialFlowState, {
      type: "PROJECT_LOADED",
      project: { profile, strategy, result, meta: { workspace } },
      demo: false,
    });
    expect(viaMeta.workspace.experiments).toHaveLength(1);
    const preM15 = flowReducer(initialFlowState, {
      type: "PROJECT_LOADED",
      project: { profile, strategy, result },
      demo: false,
    });
    expect(preM15.workspace.experiments).toEqual([]);
  });

  it("VARIANT_ADDED appends the draft and a timeline-visible log entry", () => {
    const s = seq(analyzed, built, generated, {
      type: "VARIANT_ADDED",
      platformId: P0,
      post: { ...post, hook: "variant hook" },
      note: "Generated follow-up variant for HN",
    });
    expect(s.result!.content.find((c) => c.platformId === P0)!.posts).toHaveLength(2);
    expect(timelineEvents(s.workspace).some((e) => e.text.includes("variant"))).toBe(true);
  });

  it("timeline lists events newest-first", () => {
    const w = ws({
      experiments: [
        experiment({
          publishedAt: hoursBefore(30),
          outcomes: [{ id: "o", checkpoint: "24h", recordedAt: hoursBefore(5) }],
        }),
      ],
    });
    const events = timelineEvents(w);
    expect(events[0].at >= events[events.length - 1].at).toBe(true);
    expect(events.some((e) => e.text.includes("Published"))).toBe(true);
  });
});
