import { describe, expect, it } from "vitest";
import { flowReducer, initialFlowState, type FlowState } from "@/hooks/launchFlowReducer";
import { DEMO_PROJECT } from "@/lib/demo";
import { deriveToday, verdictFor, weeklyReview } from "@/lib/today";
import { comparisonBoundary, normalizePlannedExperiments } from "@/lib/experimentQueue";
import { checkpointDeltas, deriveAngleEvidence } from "@/lib/learningEvidence";
import { completedScheduledVerdict, normalizeOutcome } from "@/lib/experimentHistory";
import {
  channelMetrics,
  normalizeSuccessContract,
  outcomeSignal,
} from "@/lib/successContract";
import { DRAFT_SCHEMA_VERSION, migrateDraft } from "@/lib/storage";
import { toJson, toMarkdown } from "@/lib/export";
import {
  applyActionPlan,
  proposalStale,
  validateProposedActions,
} from "@/lib/copilotActions";
import { buildShareKit } from "@/lib/experimentContract";
import { boundedCopilotRequest } from "@/lib/api";
import type { Experiment, Outcome, PlannedExperiment, SuccessContract } from "@/lib/types";

const contract: SuccessContract = {
  primaryGoal: "Useful conversations",
  primarySignal: "replies",
  minimumResult: 2,
  evaluationWindow: "72h",
};
const at = "2026-10-11T00:00:00.000Z";
const draft = {
  hook: "A small product update",
  body: "Try the interactive demo and tell us which step was unclear.",
  imageSuggestion: "",
  bestTime: "",
  caveats: "",
};
function seed(): FlowState {
  let state = flowReducer(initialFlowState, {
    type: "PROJECT_LOADED",
    demo: false,
    project: {
      ...DEMO_PROJECT,
      profile: { ...DEMO_PROJECT.profile, name: "Acme", publisherVoice: "brand" },
      facts: [],
      result: {
        content: [{ platformId: "twitter", platformName: "X / Twitter", posts: [draft] }],
        schedule: [{ day: 1, platformId: "twitter", platformName: "X", action: "Publish" }],
      },
      workspace: { experiments: [], taskLog: [], successContract: contract },
      memory: { bannedClaims: [], angles: [], rewriteFeedback: [], userEditedFields: [] },
    },
  });
  state = flowReducer(state, { type: "EXPERIMENT_CREATED", experiment: execution() });
  return state;
}
function execution(patch: Partial<Experiment> = {}): Experiment {
  return {
    id: "execution-1",
    platformId: "twitter",
    platformName: "X / Twitter",
    community: "Founders",
    angle: "Interactive demo",
    variant: draft.hook,
    hypothesis: "A useful conversation",
    trackedUrl: "",
    publishedAt: at,
    status: "live",
    postIdx: 0,
    outcomes: [],
    ...patch,
  };
}
function observation(patch: Partial<Outcome> = {}): Outcome {
  return { id: "outcome-1", checkpoint: "72h", recordedAt: at, ...patch };
}
function queued(): PlannedExperiment {
  return {
    id: "planned-1",
    templateId: "hook-test",
    sourceExperimentId: "execution-1",
    platformId: "twitter",
    platformName: "X / Twitter",
    venue: "Founders",
    angle: "Interactive demo",
    variable: "hook",
    heldConstant: "Intended body unchanged",
    successContract: contract,
    status: "planned",
    createdAt: at,
  };
}
function ctx(state: FlowState) {
  return {
    strategy: state.strategy,
    result: state.result,
    facts: state.facts,
    workspace: state.workspace,
    memory: state.memory,
  };
}
const next = { ...draft, hook: "What part of this demo was unclear?" };

describe("calibrated observations and memory", () => {
  it("blank, unavailable and measured zero are three distinct observations", () => {
    expect(outcomeSignal(observation(), "replies")).toBeUndefined();
    expect(outcomeSignal(observation({ replies: 0 }), "replies")).toBe(0);
    expect(
      outcomeSignal(observation({ replies: 0, unavailableMetrics: ["replies"] }), "replies")
    ).toBeUndefined();
    const context = { platformName: "X", angle: "demo", successContract: contract };
    expect(verdictFor(observation(), context).assessment).toBe("insufficient");
    expect(verdictFor(observation({ replies: 0 }), context).assessment).toBe(
      "target-missed"
    );
  });
  it("an early positive checkpoint does not enter final angle memory", () => {
    const state = flowReducer(seed(), {
      type: "OUTCOME_RECORDED",
      experimentId: "execution-1",
      outcome: observation({ checkpoint: "24h", replies: 5 }),
    });
    expect(state.memory.angles).toEqual([]);
  });
  it("a final measured result references its Outcome and stays early evidence", () => {
    const state = flowReducer(seed(), {
      type: "OUTCOME_RECORDED",
      experimentId: "execution-1",
      outcome: observation({ replies: 3 }),
    });
    expect(state.memory.angles[0]).toMatchObject({
      experimentId: "execution-1",
      outcomeId: "outcome-1",
      verdict: "winning",
      evidenceState: "early evidence",
    });
  });
  it("invalidation removes earlier learning without deleting history or fabricating a loss", () => {
    const measured = flowReducer(seed(), {
      type: "OUTCOME_RECORDED",
      experimentId: "execution-1",
      outcome: observation({ replies: 3 }),
    });
    const invalid = flowReducer(measured, {
      type: "OUTCOME_RECORDED",
      experimentId: "execution-1",
      outcome: observation({
        id: "invalid",
        checkpoint: "manual",
        invalidatedReason: "tracking-broken",
      }),
    });
    expect(invalid.memory.angles).toEqual([]);
    expect(invalid.workspace.experiments[0].outcomes).toHaveLength(2);
    expect(invalid.workspace.experiments[0].status).toBe("stopped");
    expect(completedScheduledVerdict(invalid.workspace.experiments[0])).toBeUndefined();
    expect(
      weeklyReview(
        { workspace: invalid.workspace, strategy: invalid.strategy },
        new Date(at)
      ).loopsThisWeek
    ).toBe(0);
  });
  it("two checkpoints of one execution never become repeated evidence", () => {
    let state = flowReducer(seed(), {
      type: "OUTCOME_RECORDED",
      experimentId: "execution-1",
      outcome: observation({ id: "first", checkpoint: "24h", replies: 4 }),
    });
    state = flowReducer(state, {
      type: "OUTCOME_RECORDED",
      experimentId: "execution-1",
      outcome: observation({ replies: 5 }),
    });
    expect(state.memory.angles).toHaveLength(1);
    expect(state.memory.angles[0].evidenceState).toBe("early evidence");
  });
  it("repeated/conflicting evidence requires separate comparable executions", () => {
    const state = flowReducer(seed(), {
      type: "OUTCOME_RECORDED",
      experimentId: "execution-1",
      outcome: observation({ replies: 3 }),
    });
    const first = state.workspace.experiments[0];
    const second = {
      ...first,
      id: "execution-2",
      outcomes: [{ ...first.outcomes[0], id: "second" }],
    };
    expect(
      deriveAngleEvidence({ ...state.workspace, experiments: [first, second] }).every(
        (item) => item.evidenceState === "repeated evidence"
      )
    ).toBe(true);
    second.outcomes[0] = {
      ...second.outcomes[0],
      replies: 0,
      verdict: verdictFor(observation({ replies: 0 }), {
        platformName: "X",
        angle: "demo",
        successContract: contract,
      }),
    };
    expect(
      deriveAngleEvidence({ ...state.workspace, experiments: [first, second] }).every(
        (item) => item.evidenceState === "conflicting evidence"
      )
    ).toBe(true);
    const changed = { ...second, successContract: { ...contract, minimumResult: 10 } };
    expect(
      deriveAngleEvidence({ ...state.workspace, experiments: [first, changed] }).every(
        (item) => item.evidenceState === "early evidence"
      )
    ).toBe(true);
  });
  it("72h differences exist only for actually observed cumulative values", () => {
    const exp = execution({
      outcomes: [observation({ checkpoint: "24h", replies: 2, clicks: 5 })],
    });
    expect(
      checkpointDeltas(
        exp,
        observation({ replies: 4, clicks: 20, unavailableMetrics: ["clicks"] })
      )
    ).toEqual([{ metric: "replies", delta: 2 }]);
  });
  it("malformed saved observations cannot become zero or crash rendering", () => {
    const value = normalizeOutcome({
      ...observation(),
      replies: null,
      clicks: -1,
      stars: 0,
      unavailableMetrics: { includes: "not a function" },
    })!;
    expect(value.replies).toBeUndefined();
    expect(value.clicks).toBeUndefined();
    expect(value.stars).toBe(0);
    expect(outcomeSignal(value, "replies")).toBeUndefined();
  });
  it("channel-specific metrics and named custom signals stay bounded", () => {
    expect(channelMetrics("github")).toContain("stars");
    expect(channelMetrics("reddit")).toContain("qualifiedReplies");
    expect(channelMetrics("producthunt")).toContain("upvotes");
    expect(normalizeSuccessContract({ ...contract, primarySignal: "custom" })).toBeNull();
    expect(
      normalizeSuccessContract({
        ...contract,
        primarySignal: "custom",
        customSignalLabel: "Completed demo tasks",
        baseline: null,
      })?.baseline
    ).toBeUndefined();
    expect(normalizeSuccessContract({ ...contract, minimumResult: true })).toBeNull();
  });
});

describe("persistent next-experiment decisions", () => {
  it("model history stays bounded without discarding persisted execution history", () => {
    const state = seed();
    const workspace = {
      ...state.workspace,
      experiments: Array.from({ length: 40 }, (_, index) =>
        execution({
          id: `execution-${index}`,
          outcomes: Array.from({ length: 8 }, (_, i) => observation({ id: `o-${i}` })),
        })
      ),
    };
    const bounded = boundedCopilotRequest({
      action: "ask",
      profile: state.profile!,
      strategy: state.strategy!,
      workspace,
    });
    expect(bounded.workspace?.experiments).toHaveLength(30);
    expect(bounded.workspace?.experiments[0].outcomes).toHaveLength(6);
    expect(workspace.experiments).toHaveLength(40);
    expect(workspace.experiments[0].outcomes).toHaveLength(8);
  });
  it("confirm, prepare and publish are separate idempotent transitions", () => {
    const initial = seed();
    const planned = flowReducer(initial, { type: "EXPERIMENT_PLANNED", plan: queued() });
    expect(planned.result).toBe(initial.result);
    expect(flowReducer(planned, { type: "EXPERIMENT_PLANNED", plan: queued() })).toBe(
      planned
    );
    expect(
      deriveToday(
        {
          strategy: planned.strategy,
          result: planned.result!,
          workspace: planned.workspace,
        },
        new Date(at)
      ).actions.some(
        (item) => item.kind === "prepare" && item.plannedExperimentId === "planned-1"
      )
    ).toBe(true);
    const ready = flowReducer(planned, {
      type: "PLANNED_DRAFT_PREPARED",
      id: "planned-1",
      post: next,
    });
    expect(ready.workspace.plannedExperiments?.[0]).toMatchObject({
      status: "ready",
      postIdx: 1,
    });
    expect(
      flowReducer(ready, { type: "PLANNED_DRAFT_PREPARED", id: "planned-1", post: next })
    ).toBe(ready);
    const published = flowReducer(ready, {
      type: "EXPERIMENT_CREATED",
      experiment: execution({ id: "execution-2", postIdx: 1, variant: next.hook }),
    });
    expect(published.workspace.experiments).toHaveLength(2);
    expect(published.workspace.experiments[1]).toMatchObject({
      plannedExperimentId: "planned-1",
      snapshot: { variable: "hook", draft: { body: draft.body, hook: next.hook } },
    });
    expect(published.workspace.plannedExperiments?.[0]).toMatchObject({
      status: "published",
      executionId: "execution-2",
    });
    expect(
      flowReducer(published, {
        type: "EXPERIMENT_CREATED",
        experiment: execution({ id: "double-click", postIdx: 1 }),
      })
    ).toBe(published);
  });
  it("cancelled work ignores a late generated response", () => {
    const planned = flowReducer(seed(), { type: "EXPERIMENT_PLANNED", plan: queued() });
    const cancelled = flowReducer(planned, {
      type: "PLANNED_EXPERIMENT_CANCELLED",
      id: "planned-1",
    });
    expect(
      flowReducer(cancelled, {
        type: "PLANNED_DRAFT_PREPARED",
        id: "planned-1",
        post: next,
      })
    ).toBe(cancelled);
  });
  it("missing source/outcome IDs cannot create follow-up work", () => {
    const state = seed();
    expect(
      flowReducer(state, {
        type: "EXPERIMENT_PLANNED",
        plan: { ...queued(), sourceOutcomeId: "invented" },
      })
    ).toBe(state);
    expect(
      flowReducer(state, {
        type: "EXPERIMENT_CREATED",
        experiment: execution({ id: "new", postIdx: 1, plannedExperimentId: "invented" }),
      })
    ).toBe(state);
  });
  it("queue JSON rejects unknown platforms, duplicate IDs and missing ready indices", () => {
    const values = normalizePlannedExperiments([
      queued(),
      queued(),
      { ...queued(), id: "bad", platformId: "evil" },
      { ...queued(), id: "not-ready", status: "ready" },
    ]);
    expect(values).toHaveLength(2);
    expect(values[1].status).toBe("planned");
  });
  it("published snapshots do not follow later body, voice, audience or goal edits", () => {
    const state = seed();
    const changed = flowReducer(state, {
      type: "PROFILE_SET",
      profile: { ...state.profile!, audience: "Someone else", publisherVoice: "founder" },
    });
    expect(changed.workspace.experiments[0].snapshot?.audience).toBe(
      state.profile?.audience
    );
    expect(changed.workspace.experiments[0].snapshot?.draft.body).toBe(draft.body);
    expect(changed.workspace.experiments[0].snapshot?.publisherVoice).toBe("brand");
  });
  it("a changed held condition downgrades the test instead of claiming control", () => {
    const source = seed().workspace.experiments[0];
    const candidate = { ...source.snapshot!, draft: next, variable: "hook" as const };
    expect(comparisonBoundary(source, candidate, "Founders", source.angle).variable).toBe(
      "hook"
    );
    expect(
      comparisonBoundary(
        source,
        { ...candidate, draft: { ...next, body: "Also changed" } },
        "Founders",
        source.angle
      ).variable
    ).toBe("exploratory");
    expect(
      comparisonBoundary(
        source,
        { ...candidate, audience: "Changed" },
        "Founders",
        source.angle
      ).variable
    ).toBe("exploratory");
    expect(
      comparisonBoundary(undefined, candidate, "Founders", source.angle).variable
    ).toBe("exploratory");
  });
  it("v10 refresh and both exports preserve queue, observations and snapshots", () => {
    const state = flowReducer(seed(), { type: "EXPERIMENT_PLANNED", plan: queued() });
    const serialized = toJson({
      profile: state.profile,
      strategy: state.strategy,
      result: state.result,
      workspace: state.workspace,
      memory: state.memory,
    });
    const migrated = migrateDraft(JSON.parse(serialized))!;
    expect(migrated.schemaVersion).toBe(DRAFT_SCHEMA_VERSION);
    const restored = flowReducer(initialFlowState, {
      type: "PROJECT_LOADED",
      project: migrated,
      demo: false,
    });
    expect(restored.workspace.plannedExperiments).toEqual(
      state.workspace.plannedExperiments
    );
    expect(restored.workspace.experiments[0].snapshot).toEqual(
      state.workspace.experiments[0].snapshot
    );
    expect(
      toMarkdown({
        profile: restored.profile,
        result: restored.result,
        workspace: restored.workspace,
      })
    ).toContain("Planned experiment queue");
    expect(
      flowReducer(restored, { type: "RESET" }).workspace.plannedExperiments
    ).toBeUndefined();
  });
});

describe("scoped repair and truthful product share kits", () => {
  it("repair rejects the wrong draft and binds the actual source before Apply", () => {
    const state = seed();
    const context = { ...ctx(state), targetPlatformId: "twitter", targetPostIdx: 0 };
    const raw = {
      tool: "generate_variant",
      platformId: "twitter",
      rationale: "Repair the selected draft",
      hook: "Revised hook",
      body: draft.body,
      sourceDraft: { hook: "forged", body: "forged" },
    };
    expect(validateProposedActions([{ ...raw, postIdx: 1 }], context).actions).toEqual([]);
    expect(
      validateProposedActions(
        [
          {
            tool: "generate_variant",
            platformId: "twitter",
            postIdx: 0,
            direction: "Rewrite",
            rationale: "Repair",
          },
        ],
        context
      ).actions
    ).toEqual([]);
    const action = validateProposedActions([raw], context).actions[0];
    expect(action.tool === "generate_variant" && action.sourceDraft).toEqual({
      hook: draft.hook,
      body: draft.body,
    });
    expect(proposalStale(action, context)).toBe(false);
    const changed = {
      ...context,
      result: {
        ...state.result!,
        content: [{ ...state.result!.content[0], posts: [next] }],
      },
    };
    expect(proposalStale(action, changed)).toBe(true);
    expect(applyActionPlan(action, changed)).toEqual([]);
  });
  it("default Share Kit promotes the user's product, not PostBeacon", () => {
    const state = seed();
    const input = {
      profile: state.profile!,
      content: state.result!.content[0],
      post: draft,
      facts: [],
      productUrl: "https://acme.example/demo",
    };
    const kit = buildShareKit(input);
    expect(kit.xPosts[0]).toBe(draft.hook);
    expect(kit.xPosts[1]).toBe(draft.body);
    expect(kit.xPosts[2]).toContain("https://acme.example/demo");
    expect(kit.xPosts.join(" ")).not.toContain("PostBeacon");
    expect(kit.copyReady).toBe(true);
    expect(buildShareKit({ ...input, shareMode: "process" }).xPosts.join(" ")).toContain(
      "PostBeacon"
    );
  });
  it("unsafe entry points, unsupported promises and long copy block copying without truncation", () => {
    const state = seed();
    const input = {
      profile: state.profile!,
      content: state.result!.content[0],
      post: draft,
      facts: [],
      productUrl: "javascript:alert(1)",
    };
    expect(buildShareKit(input).copyReady).toBe(false);
    const long = "Complete source claim. ".repeat(30);
    const kit = buildShareKit({
      ...input,
      productUrl: "https://acme.example",
      post: { ...draft, body: long },
    });
    expect(kit.xPosts[1]).toBe(long);
    expect(kit.copyReady).toBe(false);
    expect(
      buildShareKit({
        ...input,
        productUrl: "https://acme.example",
        post: { ...draft, body: "Trusted by 50,000 customers. Guaranteed returns." },
      }).copyReady
    ).toBe(false);
  });
});
