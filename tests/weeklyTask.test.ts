import { describe, expect, it } from "vitest";
import {
  flowReducer,
  initialFlowState,
  weeklyTaskContext,
  type FlowState,
} from "@/hooks/launchFlowReducer";
import { DEMO_PROJECT } from "@/lib/demo";
import { trialProductFacts } from "@/lib/opportunityResearch";
import { DRAFT_SCHEMA_VERSION, migrateDraft } from "@/lib/storage";
import { boundedCopilotRequest } from "@/lib/api";
import {
  applyWeeklyTaskCommand,
  checkWeeklyTaskEvidence,
  exampleWeeklyTaskProposal,
  mentionsRepoInternals,
  normalizeWeeklyTask,
  normalizeWeeklyTaskProposal,
  renderBuildBrief,
  type WeeklyTaskCommand,
} from "@/lib/weeklyTask";
import type { CopilotRequest, WeeklyTask } from "@/lib/types";

const AT = "2026-11-16T10:00:00.000Z";
const intake = {
  pain: "New visitors do not understand what to do first",
  successSignal: "Three people finish the first task unaided",
  hoursAvailable: 4,
};
const facts = DEMO_PROJECT.facts;
const verified = trialProductFacts(facts);
const grounded = () => ({
  kind: "product-improvement",
  title: "Add a sample project to the empty state",
  rationale: "The first screen is empty, so visitors cannot see what the product does.",
  factIds: [verified[0].id, "invented-fact"],
  minimalScope: ["Show one read-only sample on first visit"],
  assumptions: ["Visitors arrive signed out"],
  nonGoals: ["No onboarding tour"],
  acceptance: ["A signed-out visitor sees the sample", "The sample can be dismissed"],
  tests: ["Cover the empty state with and without the sample"],
  unknowns: ["Whether the empty screen is why people leave"],
});
const evidence = (results = ["passed", "passed"]) => ({
  changeSummary: "Shipped a read-only sample on the first screen on Tuesday.",
  proof: "Opened the live site signed out and the sample loaded; dismiss worked.",
  results,
});

/** A real flow state (demo project, not demo mode) so commands run through the reducer. */
function loaded(demo = false): FlowState {
  return flowReducer(initialFlowState, {
    type: "PROJECT_LOADED",
    project: { ...DEMO_PROJECT, id: "project-a" },
    demo,
  });
}
const run = (state: FlowState, command: WeeklyTaskCommand, projectId = state.projectId) =>
  flowReducer(state, { type: "WEEKLY_TASK_COMMAND", projectId, command });
const task = (state: FlowState) => state.workspace.weeklyTask as WeeklyTask;

function proposed(source: "model" | "founder" = "model") {
  let state = run(loaded(), { type: "intake-saved", id: "task-1", intake, at: AT });
  state = run(state, {
    type: "proposal-received",
    taskId: "task-1",
    revision: task(state).revision,
    contextKey: weeklyTaskContext(state).contextKey,
    proposal: grounded(),
    source,
    at: AT,
  });
  return state;
}
function building() {
  const state = proposed();
  return run(state, {
    type: "confirmed",
    taskId: "task-1",
    revision: task(state).revision,
    at: AT,
  });
}
function verifying() {
  const state = building();
  return run(state, {
    type: "ready-to-verify",
    taskId: "task-1",
    revision: task(state).revision,
    at: AT,
  });
}

describe("weekly task proposal boundary", () => {
  it("keeps only verified fact ids and refuses an ungrounded product improvement", () => {
    const ok = normalizeWeeklyTaskProposal(grounded(), facts, "model");
    expect(ok?.factIds).toEqual([verified[0].id]);
    expect(
      normalizeWeeklyTaskProposal({ ...grounded(), factIds: ["invented"] }, facts, "model")
    ).toBeUndefined();
  });
  it("allows a learn-first task without facts only when it states what is unknown", () => {
    const learn = { ...grounded(), kind: "validate-demand", factIds: [] };
    expect(normalizeWeeklyTaskProposal(learn, facts, "model")?.kind).toBe(
      "validate-demand"
    );
    expect(
      normalizeWeeklyTaskProposal({ ...learn, unknowns: [] }, facts, "model")
    ).toBeUndefined();
  });
  it("treats framework names, sites and ordinary prose as prose, not files", () => {
    for (const text of [
      "Add a Next.js starter example",
      "Built with Node.js and Vue.js",
      "Publish the crate docs on docs.rs",
      "Visit example.com/pricing.html before signing up",
      "Show a sample at https://acme.example/src/demo.html",
      "Reply within 24/7 support hours, e.g. on v2.0",
      "Offer signup/login in one step. Users drop off today",
      "Read the reviews people left and check the pricing page",
    ])
      expect(mentionsRepoInternals(text), text).toBe(false);
  });
  it("catches file names, code paths, code symbols and inspection claims", () => {
    for (const text of [
      "Edit src/components/Empty.tsx",
      "Update middleware.ts to redirect",
      "Read the README.md first",
      "Update package.json",
      "Fix index.html",
      "Edit src/components/Header",
      "Change the handleSubmit function in the auth module",
      "I reviewed your codebase and found a bug",
      "I've reviewed your code",
      "After reviewing your codebase, the signup is slow",
      "Looking at your repository, the signup is slow",
      "In your repository we found no tests",
    ])
      expect(mentionsRepoInternals(text), text).toBe(true);
  });
  it("refuses the whole agent proposal on any repository claim, never trims it silently", () => {
    const withPath = {
      ...grounded(),
      minimalScope: ["Change app/page.tsx", "Show one read-only sample"],
    };
    expect(normalizeWeeklyTaskProposal(withPath, facts, "model")).toBeUndefined();
    expect(
      normalizeWeeklyTaskProposal(
        { ...grounded(), rationale: "We inspected your repository and saw no tests." },
        facts,
        "model"
      )
    ).toBeUndefined();
    expect(
      normalizeWeeklyTaskProposal(
        { ...grounded(), title: "Add a Next.js starter to the empty state" },
        facts,
        "model"
      )?.title
    ).toContain("Next.js");
    // The founder may name their own files.
    expect(
      normalizeWeeklyTaskProposal(withPath, facts, "founder")?.minimalScope
    ).toHaveLength(2);
  });
});

describe("weekly task state machine", () => {
  it("walks planning → proposed → building → verifying → verified with rising revisions", () => {
    let state = verifying();
    expect(task(state).status).toBe("verifying");
    const before = task(state).revision;
    state = run(state, {
      type: "evidence-submitted",
      taskId: "task-1",
      revision: before,
      evidence: evidence(),
      at: AT,
    });
    expect(task(state).status).toBe("verified");
    expect(task(state).revision).toBe(before + 1);
    expect(task(state).evidence?.results).toEqual(["passed", "passed"]);
    state = run(state, { type: "closed", taskId: "task-1", at: AT });
    expect(state.workspace.weeklyTask).toBeUndefined();
    expect(state.workspace.weeklyTaskHistory).toEqual([
      expect.objectContaining({ id: "task-1", outcome: "verified" }),
    ]);
  });
  it("ignores a duplicate confirmation and a confirmation from a stale view", () => {
    const state = proposed();
    const revision = task(state).revision;
    const confirm: WeeklyTaskCommand = {
      type: "confirmed",
      taskId: "task-1",
      revision,
      at: AT,
    };
    const once = run(state, confirm);
    const twice = run(once, confirm);
    expect(task(once).status).toBe("building");
    expect(twice).toBe(once); // same object: nothing changed
    const edited = run(state, {
      type: "proposal-edited",
      taskId: "task-1",
      revision,
      proposal: { ...grounded(), title: "A different task entirely" },
      at: AT,
    });
    // The first tab still holds the old revision: it must not confirm the edited text.
    expect(run(edited, confirm)).toBe(edited);
    expect(task(edited).founderEdited).toBe(true);
  });
  it("discards a proposal for an older revision, another task or changed facts", () => {
    const start = run(loaded(), { type: "intake-saved", id: "task-1", intake, at: AT });
    const base = {
      type: "proposal-received" as const,
      taskId: "task-1",
      revision: task(start).revision,
      contextKey: weeklyTaskContext(start).contextKey,
      proposal: grounded(),
      source: "model" as const,
      at: AT,
    };
    expect(run(start, { ...base, revision: base.revision - 1 })).toBe(start);
    expect(run(start, { ...base, taskId: "other" })).toBe(start);
    expect(run(start, { ...base, contextKey: "older product version" })).toBe(start);
    expect(run(start, base, "project-b")).toBe(start); // response for another project
    expect(run(start, { ...base, source: "example" })).toBe(start); // not the demo
    // Editing inputs while a request is in flight bumps the revision → late response dropped.
    const edited = run(start, {
      type: "intake-saved",
      id: "task-1",
      revision: task(start).revision,
      intake: { ...intake, hoursAvailable: 2 },
      at: AT,
    });
    expect(run(edited, base)).toBe(edited);
  });
  it("blocks confirmation after the product facts change", () => {
    const state = proposed();
    const changed = flowReducer(state, { type: "FACT_DELETED", id: verified[0].id });
    const result = applyWeeklyTaskCommand(
      changed.workspace,
      { type: "confirmed", taskId: "task-1", revision: task(changed).revision, at: AT },
      weeklyTaskContext(changed)
    );
    expect(result).toMatchObject({ ok: false });
    expect(task(changed).status).toBe("proposed");
  });
  it("freezes cited claims at confirmation so later ledger edits cannot rewrite the brief", () => {
    const state = building();
    const claim = verified[0].claim;
    expect(task(state).confirmedFacts).toEqual([{ id: verified[0].id, claim }]);
    const corrected = flowReducer(state, {
      type: "FACT_CORRECTED",
      id: verified[0].id,
      claim: "A completely different claim",
    });
    const brief = renderBuildBrief(
      task(corrected),
      { name: "Acme", url: "https://acme.example" },
      corrected.facts
    );
    expect(brief).toContain(claim);
    expect(brief).not.toContain("A completely different claim");
  });
  it("never marks a task verified without real evidence for every scenario", () => {
    const state = verifying();
    const submit = (value: unknown) =>
      run(state, {
        type: "evidence-submitted",
        taskId: "task-1",
        revision: task(state).revision,
        evidence: value,
        at: AT,
      });
    expect(submit({})).toBe(state);
    expect(submit(evidence(["passed", "failed"]))).toBe(state);
    expect(submit(evidence(["passed", "not-checked"]))).toBe(state);
    expect(submit(evidence(["passed"]))).toBe(state); // one scenario missing
    // The plan restated is not evidence.
    expect(
      submit({ ...evidence(), changeSummary: "Show one read-only sample on first visit" })
    ).toBe(state);
    expect(submit({ ...evidence(), proofUrl: "javascript:alert(1)" })).toBe(state);
    // …also with punctuation changed, two plan lines joined, or the reason reused.
    for (const copied of [
      "Show one read-only sample on first visit.",
      "Show one read-only sample on first visit. A signed-out visitor sees the sample",
      "The first screen is empty, so visitors cannot see what the product does!!",
    ]) {
      expect(submit({ ...evidence(), changeSummary: copied }), copied).toBe(state);
      expect(submit({ ...evidence(), proof: copied }), copied).toBe(state);
    }
    // Filler and one text pasted into both boxes are not evidence either.
    expect(submit({ ...evidence(), proof: "a".repeat(40) })).toBe(state);
    expect(submit({ ...evidence(), proof: "ok ok ok ok ok ok ok ok ok ok" })).toBe(state);
    expect(submit({ ...evidence(), proof: evidence().changeSummary })).toBe(state);
    // Progress notes and "ready" never verify by themselves.
    const base = building();
    const noted = run(base, {
      type: "progress-noted",
      taskId: "task-1",
      revision: task(base).revision,
      note: "Done, shipped, verified!",
      at: AT,
    });
    expect(task(noted).status).toBe("building");
    expect(checkWeeklyTaskEvidence(evidence(), task(state).proposal!, AT)).toHaveProperty(
      "evidence"
    );
  });
  it("refuses every revision-bound command issued against an older revision", () => {
    const stale = (state: FlowState, command: (revision: number) => WeeklyTaskCommand) => {
      expect(run(state, command(task(state).revision - 1))).toBe(state);
      expect(run(state, command(task(state).revision))).not.toBe(state);
    };
    stale(building(), (revision) => ({
      type: "progress-noted",
      taskId: "task-1",
      revision,
      note: "A note",
      at: AT,
    }));
    stale(building(), (revision) => ({
      type: "ready-to-verify",
      taskId: "task-1",
      revision,
      at: AT,
    }));
    stale(verifying(), (revision) => ({
      type: "reopened",
      taskId: "task-1",
      revision,
      at: AT,
    }));
    stale(verifying(), (revision) => ({
      type: "evidence-submitted",
      taskId: "task-1",
      revision,
      evidence: evidence(),
      at: AT,
    }));
    stale(proposed(), (revision) => ({
      type: "replan-requested",
      taskId: "task-1",
      revision,
      at: AT,
    }));
  });
  it("cannot skip steps", () => {
    const start = proposed();
    const revision = task(start).revision;
    for (const type of ["ready-to-verify", "reopened"] as const)
      expect(run(start, { type, taskId: "task-1", revision, at: AT })).toBe(start);
    expect(
      run(start, {
        type: "evidence-submitted",
        taskId: "task-1",
        revision,
        evidence: evidence(),
        at: AT,
      })
    ).toBe(start);
    expect(run(start, { type: "closed", taskId: "task-1", at: AT })).toBe(start);
  });
  it("abandons into history and lets a new task start", () => {
    let state = building();
    state = run(state, { type: "abandoned", taskId: "task-1", at: AT });
    expect(state.workspace.weeklyTask).toBeUndefined();
    expect(state.workspace.weeklyTaskHistory?.[0].outcome).toBe("abandoned");
    state = run(state, { type: "intake-saved", id: "task-2", intake, at: AT });
    expect(task(state).id).toBe("task-2");
  });
  it("marks demo tasks as fictional and accepts only the code-written example there", () => {
    let state = run(loaded(true), { type: "intake-saved", id: "demo", intake, at: AT });
    expect(task(state).example).toBe(true);
    const offer = (source: "model" | "founder") =>
      run(state, {
        type: "proposal-received",
        taskId: "demo",
        revision: task(state).revision,
        contextKey: weeklyTaskContext(state).contextKey,
        proposal: grounded(),
        source,
        at: AT,
      });
    expect(offer("model")).toBe(state); // the demo never holds model output
    expect(task(offer("founder")).proposalSource).toBe("founder"); // writing it yourself works
    state = run(state, {
      type: "proposal-received",
      taskId: "demo",
      revision: task(state).revision,
      contextKey: weeklyTaskContext(state).contextKey,
      proposal: exampleWeeklyTaskProposal(state.facts),
      source: "example",
      at: AT,
    });
    expect(task(state).proposalSource).toBe("example");
    expect(renderBuildBrief(task(state), { name: "Demo", url: "" }, state.facts)).toContain(
      "FICTIONAL EXAMPLE"
    );
  });
});

describe("weekly task persistence", () => {
  it("survives a save/load round trip in every state (refresh recovery)", () => {
    const planning = run(loaded(), { type: "intake-saved", id: "task-1", intake, at: AT });
    const done = verifying();
    const verified = run(done, {
      type: "evidence-submitted",
      taskId: "task-1",
      revision: task(done).revision,
      evidence: evidence(),
      at: AT,
    });
    expect(task(verified).status).toBe("verified");
    for (const state of [planning, proposed(), building(), verifying(), verified]) {
      const draft = migrateDraft(
        JSON.parse(
          JSON.stringify({
            schemaVersion: DRAFT_SCHEMA_VERSION,
            workspace: state.workspace,
          })
        )
      );
      expect(draft?.workspace?.weeklyTask).toEqual(task(state));
    }
  });
  it("repairs stored states the machine could not have produced", () => {
    const real = task(building());
    expect(normalizeWeeklyTask({ ...real, status: "verified" })?.status).toBe("verifying");
    expect(normalizeWeeklyTask({ ...real, confirmedAt: undefined })?.status).toBe(
      "proposed"
    );
    expect(normalizeWeeklyTask({ ...real, proposal: undefined })?.status).toBe("planning");
    expect(
      normalizeWeeklyTask({
        ...real,
        status: "verified",
        evidence: { ...evidence(["passed", "failed"]), submittedAt: AT },
      })?.status
    ).toBe("verifying");
    // Untouched agent text must still satisfy the agent rules after a reload.
    const ungrounded = { ...real, proposal: { ...real.proposal, factIds: [] } };
    expect(normalizeWeeklyTask(ungrounded)?.status).toBe("planning");
    expect(
      normalizeWeeklyTask({
        ...real,
        proposal: { ...real.proposal, tests: ["Update src/app/page.tsx"] },
      })?.status
    ).toBe("planning");
    expect(normalizeWeeklyTask({ ...ungrounded, founderEdited: true })?.status).toBe(
      "building"
    );
    expect(normalizeWeeklyTask({ ...real, intake: {} })).toBeUndefined();
    expect(normalizeWeeklyTask("nonsense")).toBeUndefined();
  });
  it("keeps a confirmed task through re-analysis but drops an unconfirmed one", () => {
    const reanalyze = (state: FlowState) =>
      flowReducer(state, {
        type: "ANALYZED",
        profile: state.profile!,
        facts: state.facts,
        questions: [],
      });
    expect(reanalyze(building()).workspace.weeklyTask?.status).toBe("building");
    expect(reanalyze(proposed()).workspace.weeklyTask).toBeUndefined();
  });
  it("never lets a fictional demo task or its history into a real project", () => {
    let demo = run(loaded(true), { type: "intake-saved", id: "demo", intake, at: AT });
    demo = run(demo, {
      type: "proposal-received",
      taskId: "demo",
      revision: task(demo).revision,
      contextKey: weeklyTaskContext(demo).contextKey,
      proposal: exampleWeeklyTaskProposal(demo.facts),
      source: "example",
      at: AT,
    });
    demo = run(demo, {
      type: "confirmed",
      taskId: "demo",
      revision: task(demo).revision,
      at: AT,
    });
    expect(task(demo).status).toBe("building");
    // Analyzing a real product from inside the demo.
    const real = flowReducer(demo, {
      type: "ANALYZED",
      profile: demo.profile!,
      facts: demo.facts,
      questions: [],
    });
    expect(real.demo).toBe(false);
    expect(real.workspace.weeklyTask).toBeUndefined();
    const abandoned = run(demo, { type: "abandoned", taskId: "demo", at: AT });
    expect(abandoned.workspace.weeklyTaskHistory).toHaveLength(1);
    expect(
      flowReducer(abandoned, {
        type: "ANALYZED",
        profile: demo.profile!,
        facts: demo.facts,
        questions: [],
      }).workspace.weeklyTaskHistory
    ).toBeUndefined();
    // …and an example task that somehow reached storage is dropped on a real load.
    const reloaded = flowReducer(initialFlowState, {
      type: "PROJECT_LOADED",
      project: { ...DEMO_PROJECT, id: "project-a", workspace: demo.workspace },
      demo: false,
    });
    expect(reloaded.workspace.weeklyTask).toBeUndefined();
  });
  it("stores a short fingerprint of the product version, not the whole ledger", () => {
    const state = proposed();
    expect(task(state).contextKey!.length).toBeLessThan(60);
    const changed = flowReducer(state, { type: "FACT_DELETED", id: verified[0].id });
    expect(weeklyTaskContext(changed).contextKey).not.toBe(task(state).contextKey);
  });
  it("never sends the task to the Copilot model implicitly", () => {
    const state = building();
    const bounded = boundedCopilotRequest({
      workspace: state.workspace,
    } as CopilotRequest);
    expect(bounded.workspace?.weeklyTask).toBeUndefined();
    expect(bounded.workspace?.weeklyTaskHistory).toBeUndefined();
  });
});

describe("Build Brief", () => {
  it("contains background, goal, boundaries, acceptance and test requirements — and no file paths", () => {
    const state = building();
    const brief = renderBuildBrief(
      task(state),
      { name: "Acme", url: "https://acme.example" },
      state.facts
    );
    for (const heading of [
      "## Background",
      "## Goal",
      "## Scope (smallest version)",
      "## Boundaries — do not do",
      "## Unknowns",
      "## Acceptance scenarios",
      "## Test requirements",
      "## Repository note",
    ])
      expect(brief).toContain(heading);
    expect(brief).toContain(intake.pain);
    expect(brief).toContain("1. A signed-out visitor sees the sample");
    expect(brief).toContain("PostBeacon has NOT read the repository");
    expect(mentionsRepoInternals(brief.replace("https://acme.example", ""))).toBe(false);
    expect(brief).not.toContain("FICTIONAL");
  });
});
