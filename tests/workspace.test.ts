import { describe, expect, it } from "vitest";
import {
  activationProgress,
  deriveToday,
  dueCheckpoints,
  timelineEvents,
  verdictFor,
  weeklyReview,
  MAX_TODAY_ACTIONS,
} from "@/lib/today";
import { flowReducer, initialFlowState, type FlowAction } from "@/hooks/launchFlowReducer";
import { PLATFORMS } from "@/lib/platforms";
import { postTaskId } from "@/lib/experimentIdentity";
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
    expect(view.primaryAction).toEqual(view.actions[0]);
    expect(view.alternatives).toEqual(view.actions.slice(1));
    expect(view.mode).toBe("launch");
  });

  it("due check-ins outrank posting actions", () => {
    const view = deriveToday(plan(ws({ experiments: [experiment()] })), NOW);
    expect(view.actions[0].kind).toBe("record");
    expect(view.actions[0].checkpoint).toBe("24h");
    expect(view.dueRecordCount).toBe(1);
    expect(view.mode).toBe("growth");
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
    expect(dueTitles).toContain(postTaskId(P0, 0)); // day 1 ≤ 3
    expect(dueTitles).toContain(postTaskId(P1, 0)); // day 2 ≤ 3
    const p2 = view.actions.find((a) => a.id === postTaskId(P2, 0));
    expect(p2?.due).toBe(false); // day 9 — up next, not due
    const p0 = view.actions.find((a) => a.id === postTaskId(P0, 0))!;
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
    expect(ids).not.toContain(postTaskId(P0, 0)); // legacy skipped task
    expect(ids).not.toContain(postTaskId(P1, 0)); // already published draft
  });

  it("offers a second draft on the same channel with a distinct task identity", () => {
    const withVariant: GenerateResult = {
      ...result,
      content: result.content.map((content) =>
        content.platformId === P0
          ? { ...content, posts: [post, { ...post, hook: "second hook" }] }
          : content
      ),
    };
    const view = deriveToday(
      {
        ...plan(
          ws({
            experiments: [experiment({ platformId: P0, postIdx: 0 })],
          })
        ),
        result: withVariant,
      },
      NOW
    );
    const second = view.actions.find((action) => action.id === postTaskId(P0, 1));
    expect(second?.postIdx).toBe(1);
    expect(second?.platformId).toBe(P0);
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

describe("activationProgress — first value without cross-user tracking", () => {
  it("moves from plan → publish → first completed learning loop", () => {
    const planOnly = activationProgress(ws());
    expect(planOnly.completed).toBe(1);
    expect(planOnly.nextStep).toMatch(/publish/i);

    const published = activationProgress(ws({ experiments: [experiment()] }));
    expect(published.completed).toBe(2);
    expect(published.nextStep).toMatch(/24h/i);

    const learned = activationProgress(
      ws({
        experiments: [
          experiment({
            outcomes: [
              {
                id: "first-read",
                checkpoint: "24h",
                recordedAt: NOW.toISOString(),
              },
            ],
            verdict: {
              call: "promising",
              reason: "real engagement",
              advice: "continue",
              decidedAt: NOW.toISOString(),
            },
          }),
        ],
      })
    );
    expect(learned.completed).toBe(3);
    expect(learned.activated).toBe(true);
    expect(learned.nextStep).toMatch(/second experiment/i);
  });

  it("keeps an early manual read useful without calling the experiment complete", () => {
    const early = activationProgress(
      ws({
        experiments: [
          experiment({
            outcomes: [
              {
                id: "early",
                checkpoint: "manual",
                recordedAt: NOW.toISOString(),
                replies: 4,
              },
            ],
            verdict: {
              call: "promising",
              reason: "early replies",
              advice: "wait for 24h",
              decidedAt: NOW.toISOString(),
            },
          }),
        ],
      })
    );
    expect(early.loopsClosed).toBe(0);
    expect(early.completed).toBe(2);
    expect(early.nextStep).toMatch(/24h/i);
  });

  it("turns repeated loops into the habit signal", () => {
    const decided = (id: string): Experiment =>
      experiment({
        id,
        outcomes: [
          {
            id: `result-${id}`,
            checkpoint: "24h",
            recordedAt: NOW.toISOString(),
          },
        ],
        verdict: {
          call: "supported",
          reason: "converted",
          advice: "repeat",
          decidedAt: NOW.toISOString(),
        },
      });
    const progress = activationProgress(
      ws({ experiments: [decided("one"), decided("two")] })
    );
    expect(progress.loopsClosed).toBe(2);
    expect(progress.nextStep).toMatch(/weekly rhythm/i);
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
    const early = verdictFor(outcome({ checkpoint: "manual" }), ctx);
    expect(early.reason).toMatch(/early/i);
    expect(early.advice).toMatch(/24h/i);
  });
  it("explicit observed zeros remain a truthful no-response signal", () => {
    const v24 = verdictFor(
      outcome({ impressions: 0, replies: 0, clicks: 0, signups: 0, revenue: 0 }),
      ctx
    );
    expect(v24.call).toBe("no-signal");
    expect(v24.advice).toMatch(/72h/i);

    const v72 = verdictFor(
      outcome({
        checkpoint: "72h",
        impressions: 0,
        replies: 0,
        clicks: 0,
        signups: 0,
        revenue: 0,
      }),
      ctx
    );
    expect(v72.call).toBe("no-signal");
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
      taskId: postTaskId(P0, 0),
    });
    expect(s.workspace.experiments).toHaveLength(1);
    expect(s.posted[`${P0}-0`]).toBe(true);
    expect(s.workspace.taskLog.find((t) => t.id === postTaskId(P0, 0))?.status).toBe(
      "done"
    );
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
    expect(exp.outcomes[0].verdict?.call).toBe("supported");
    expect(exp.verdict?.call).toBe("supported");
    expect(exp.status).toBe("analyzed");
  });

  it("does not overwrite the earlier checkpoint's verdict when 72h lands", () => {
    const after24 = seq(
      analyzed,
      built,
      generated,
      { type: "EXPERIMENT_CREATED", experiment: experiment() },
      {
        type: "OUTCOME_RECORDED",
        experimentId: "exp-1",
        outcome: {
          id: "o24",
          checkpoint: "24h",
          recordedAt: hoursBefore(48),
          replies: 4,
        },
      }
    );
    const after72 = flowReducer(after24, {
      type: "OUTCOME_RECORDED",
      experimentId: "exp-1",
      outcome: {
        id: "o72",
        checkpoint: "72h",
        recordedAt: hoursBefore(1),
        signups: 2,
      },
    });
    const exp = after72.workspace.experiments[0];
    // Replies cannot substitute for the configured signup signal. The 24h
    // checkpoint remains an honest insufficient-evidence read.
    expect(exp.outcomes[0].verdict?.call).toBe("no-signal");
    expect(exp.outcomes[0].verdict?.reason).toMatch(/not measured/i);
    expect(exp.outcomes[0].verdict?.decidedAt).toBe(hoursBefore(48));
    expect(exp.outcomes[1].verdict?.call).toBe("supported");
    expect(exp.verdict).toEqual(exp.outcomes[1].verdict);
  });

  it("a fresh analysis clears the loop history but keeps the weekly budget", () => {
    const s = seq(
      analyzed,
      built,
      generated,
      { type: "WEEKLY_MINUTES_SET", minutes: 300 },
      {
        type: "EMAIL_REMINDERS_SET",
        enabled: true,
        timezone: "America/Los_Angeles",
        at: NOW.toISOString(),
      },
      { type: "EXPERIMENT_CREATED", experiment: experiment() },
      analyzed
    );
    expect(s.workspace.experiments).toEqual([]);
    expect(s.workspace.weeklyMinutes).toBe(300);
    expect(s.workspace.reminderPreferences?.email).toBe(true);
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

  it("keeps the 24h and 72h timeline verdicts distinct", () => {
    const v24 = {
      call: "promising" as const,
      reason: "early engagement",
      advice: "wait",
      decidedAt: hoursBefore(48),
    };
    const v72 = {
      call: "supported" as const,
      reason: "converted later",
      advice: "repeat",
      decidedAt: hoursBefore(1),
    };
    const events = timelineEvents(
      ws({
        experiments: [
          experiment({
            outcomes: [
              { id: "24", checkpoint: "24h", recordedAt: hoursBefore(48), verdict: v24 },
              { id: "72", checkpoint: "72h", recordedAt: hoursBefore(1), verdict: v72 },
            ],
            verdict: v72,
          }),
        ],
      })
    );
    expect(
      events.some((event) => event.text.includes("24h") && event.text.includes("promising"))
    ).toBe(true);
    expect(
      events.some((event) => event.text.includes("72h") && event.text.includes("supported"))
    ).toBe(true);
  });

  it("labels an unrecoverable legacy verdict once instead of assigning it to a checkpoint", () => {
    const events = timelineEvents(
      ws({
        experiments: [
          experiment({
            outcomes: [{ id: "old", checkpoint: "24h", recordedAt: hoursBefore(5) }],
            verdict: {
              call: "weak",
              reason: "legacy final read",
              advice: "change",
              decidedAt: hoursBefore(4),
            },
          }),
        ],
      })
    );
    expect(
      events.filter((event) => event.text.includes("Historical final verdict"))
    ).toHaveLength(1);
    expect(events.find((event) => event.text.includes("Recorded 24h"))?.text).not.toContain(
      "weak"
    );
  });
});
