import { describe, expect, it } from "vitest";
import {
  defaultSelection,
  flowReducer,
  initialFlowState,
  type FlowAction,
  type FlowState,
} from "@/hooks/launchFlowReducer";
import { PLATFORMS } from "@/lib/platforms";
import { DEMO_PROJECT } from "@/lib/demo";
import type { GenerateResult, MarketingStrategy, ProductProfile } from "@/lib/types";

const [P0, P1, P2] = PLATFORMS.map((p) => p.id);

const profile: ProductProfile = {
  name: "Acme",
  tagline: "t",
  valueProp: "v",
  audience: "a",
  differentiators: [],
  features: [],
  tone: "",
  category: "tool",
};

const rec = (platformId: string, score: number) => ({
  platformId,
  platformName: platformId,
  score,
  priority: "medium" as const,
  rationale: "",
  angle: "",
});

const strategy: MarketingStrategy = {
  positioning: "p",
  overallStrategy: "o",
  recommendations: [rec(P0, 90), rec(P1, 80), rec(P2, 70)],
};

const result: GenerateResult = {
  content: [
    {
      platformId: P0,
      platformName: P0,
      posts: [{ hook: "h", body: "b", imageSuggestion: "", bestTime: "", caveats: "" }],
    },
    {
      platformId: P1,
      platformName: P1,
      posts: [{ hook: "h", body: "b", imageSuggestion: "", bestTime: "", caveats: "" }],
    },
  ],
  schedule: [
    { day: 3, platformId: P0, platformName: P0, action: "post" },
    { day: 1, platformId: P1, platformName: P1, action: "post" },
  ],
  failures: [{ platformId: P2, platformName: P2, error: "boom" }],
};

function seq(...actions: FlowAction[]): FlowState {
  return actions.reduce(flowReducer, initialFlowState);
}

const analyzed: FlowAction = { type: "ANALYZED", profile, facts: [], questions: [] };
const built: FlowAction = { type: "STRATEGY_BUILT", strategy };
const generated: FlowAction = { type: "GENERATED", result };

describe("flowReducer invariants", () => {
  it("a fresh analysis clears everything derived from the previous product", () => {
    const s = seq(
      analyzed,
      built,
      generated,
      { type: "POSTED_TOGGLED", id: `${P0}-0` },
      analyzed
    );
    expect(s.strategy).toBeNull();
    expect(s.result).toBeNull();
    expect(s.selected).toEqual([]);
    expect(s.posted).toEqual({});
    expect(s.step).toBe("profile");
  });

  it("a rebuilt strategy invalidates the old result and reseeds the selection", () => {
    const s = seq(analyzed, built, generated, built);
    expect(s.result).toBeNull();
    expect(s.posted).toEqual({});
    expect(s.selected).toEqual(defaultSelection(strategy.recommendations));
    expect(s.step).toBe("strategy");
  });

  it("selection can never reference channels the strategy doesn't have", () => {
    const s = seq(analyzed, built, {
      type: "SELECTION_TOGGLED",
      platformId: "not-a-channel",
    });
    expect(s.selected).not.toContain("not-a-channel");
  });

  it("the step can never be deeper than the data behind it", () => {
    const s = seq(analyzed, { type: "STEP_SET", step: "results" });
    expect(s.step).toBe("profile"); // no strategy/result yet → clamped
    const s2 = seq(analyzed, built, { type: "STEP_SET", step: "results" });
    expect(s2.step).toBe("strategy");
  });

  it("removing a channel cascades: content, calendar, posted marks, selection", () => {
    const s = seq(
      analyzed,
      built,
      generated,
      { type: "SELECTION_TOGGLED", platformId: P0 }, // ensure P0 not selected... toggle twice to end selected
      { type: "SELECTION_TOGGLED", platformId: P0 },
      { type: "POSTED_TOGGLED", id: `${P0}-0` },
      { type: "CHANNEL_REMOVED", platformId: P0 }
    );
    expect(s.result!.content.some((c) => c.platformId === P0)).toBe(false);
    expect(s.result!.schedule.some((x) => x.platformId === P0)).toBe(false);
    expect(Object.keys(s.posted).some((k) => k.startsWith(`${P0}-`))).toBe(false);
    expect(s.selected).not.toContain(P0);
  });

  it("upserting a channel clears its failure, schedules it, and selects it — at rank order", () => {
    const s = seq(analyzed, built, generated, {
      type: "CHANNEL_UPSERTED",
      channel: {
        platformId: P2,
        posts: [{ hook: "h", body: "b", imageSuggestion: "", bestTime: "", caveats: "" }],
      },
    });
    expect(s.result!.failures).toEqual([]);
    expect(s.result!.content.map((c) => c.platformId)).toEqual([P0, P1, P2]); // rank order
    expect(s.result!.schedule.some((x) => x.platformId === P2)).toBe(true);
    expect(s.selected).toContain(P2);
    // schedule stays day-sorted
    const days = s.result!.schedule.map((x) => x.day);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  it("posted marks for posts that no longer exist are pruned", () => {
    const s = seq(
      analyzed,
      built,
      generated,
      { type: "POSTED_TOGGLED", id: `${P0}-0` },
      {
        type: "CHANNEL_CONTENT_REPLACED",
        channel: { platformId: P0, posts: [] }, // regenerate returned nothing
      }
    );
    expect(s.posted[`${P0}-0`]).toBeUndefined();
  });

  it("loading a project derives step, selection fallback, and resets demo explicitly", () => {
    // pre-M11 save: no selected/meta → default selection derived from scores
    const s = flowReducer(initialFlowState, {
      type: "PROJECT_LOADED",
      project: { profile, strategy, result },
      demo: false,
    });
    expect(s.step).toBe("results");
    expect(s.selected).toEqual(defaultSelection(strategy.recommendations));
    expect(s.demo).toBe(false);

    // loading a real project AFTER the demo must clear the demo flag
    const demoFirst = flowReducer(initialFlowState, {
      type: "PROJECT_LOADED",
      project: DEMO_PROJECT,
      demo: true,
    });
    expect(demoFirst.demo).toBe(true);
    const thenReal = flowReducer(demoFirst, {
      type: "PROJECT_LOADED",
      project: { profile, strategy },
      demo: false,
    });
    expect(thenReal.demo).toBe(false);
  });

  it("a contradictory loaded blob is normalized (strategy without profile is dropped)", () => {
    const s = flowReducer(initialFlowState, {
      type: "PROJECT_LOADED",
      project: { strategy, result }, // no profile — corrupt/hand-edited save
      demo: false,
    });
    expect(s.strategy).toBeNull();
    expect(s.result).toBeNull();
    expect(s.step).toBe("input");
  });

  it("question answers become user-confirmed facts and sync the profile; skips stay unknown", () => {
    const withQ = flowReducer(initialFlowState, {
      type: "ANALYZED",
      profile,
      facts: [
        {
          id: "stage",
          field: "stage",
          claim: "",
          sourceType: "model",
          status: "unknown",
          confidence: 0,
          lastVerifiedAt: "",
        },
      ],
      questions: [{ id: "stage", question: "?", why: "" }],
    });
    const answered = flowReducer(withQ, {
      type: "QUESTION_ANSWERED",
      id: "stage",
      answer: "Pre-launch",
    });
    expect(answered.questions).toEqual([]);
    expect(answered.profile?.stage).toBe("Pre-launch");
    const fact = answered.facts.find((f) => f.id === "stage")!;
    expect(fact.status).toBe("user-confirmed");

    const skipped = flowReducer(withQ, {
      type: "QUESTION_ANSWERED",
      id: "stage",
      answer: "  ",
    });
    expect(skipped.questions).toEqual([]);
    expect(skipped.facts.find((f) => f.id === "stage")!.status).toBe("unknown");
  });

  it("RESET returns to the initial state from anywhere", () => {
    const s = seq(analyzed, built, generated, { type: "RESET" });
    expect(s).toEqual(initialFlowState);
  });

  it("schedule edits re-sort by day so index-based edits stay coherent", () => {
    const s = seq(analyzed, built, generated, {
      type: "SCHEDULE_ITEM_PATCHED",
      idx: 1, // day-1 row (schedule is [day1, day3] after generate normalization? no — GENERATED keeps given order)
      patch: { day: 9 },
    });
    const days = s.result!.schedule.map((x) => x.day);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });
});
