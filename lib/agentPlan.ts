import { outreachSummary } from "./outreach";
import { dueCheckpoints } from "./today";
import type { Fact, MarketingStrategy, SuccessContract, WorkspaceState } from "./types";

/**
 * The marketing agent's plan, derived from project state on every render.
 *
 * Nothing here is stored: a step is "done" only because the thing it produces
 * exists. That keeps the plan honest after a reload, a re-analysis or an edit,
 * and means there is no second state machine to drift from the real one.
 *
 * The agent prepares; the founder decides. Steps owned by "you" never run on
 * their own, and nothing in this plan publishes anything.
 */
export type AgentStepId =
  "read" | "confirm" | "channel" | "drafts" | "publish" | "measure" | "reach" | "improve";

export type AgentStepStatus = "done" | "running" | "ready" | "needs-you" | "waiting";
export type AgentAction = "strategy" | "generate";
export type AgentView = "input" | "profile" | "strategy" | "results";

export interface AgentStep {
  id: AgentStepId;
  owner: "agent" | "you";
  title: string;
  status: AgentStepStatus;
  /** What exists now, or what is missing. Counts come from state, never a guess. */
  detail: string;
  /** Model requests this step spends when it runs. 0 for founder steps. */
  modelRequests: number;
  /** Set only when the agent can do this step right now. */
  action?: AgentAction;
  actionLabel?: string;
  /** Where the founder reviews or does this step. */
  view?: AgentView;
}

export interface AgentPlan {
  steps: AgentStep[];
  /** First step that is not done on the marketing path ("improve" runs beside it). */
  current?: AgentStep;
  doneCount: number;
  /** Requests the remaining agent steps would spend at the current selection. */
  remainingModelRequests: number;
}

export interface AgentPlanInput {
  url: string;
  hasProfile: boolean;
  facts: Fact[];
  successContract?: SuccessContract;
  strategy: MarketingStrategy | null;
  selectedCount: number;
  hasResult: boolean;
  workspace: WorkspaceState;
  loading: boolean;
  demo: boolean;
  now: Date;
}

/** Each model request per step, as the routes are written today. */
export const AGENT_STEP_REQUESTS = { read: 1, channel: 2, draftsPerChannel: 1 } as const;

const VERIFIED = new Set(["observed", "user-confirmed"]);

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function deriveAgentPlan(input: AgentPlanInput): AgentPlan {
  const { workspace, loading, now } = input;
  const contract = input.successContract;
  const hasStrategy = Boolean(input.strategy);
  const verified = input.facts.filter((fact) => VERIFIED.has(fact.status)).length;
  const unverified = input.facts.length - verified;
  const experiments = workspace.experiments;
  const latest = experiments[experiments.length - 1];
  const measured = experiments.some((experiment) => experiment.outcomes.length > 0);
  const due = latest ? dueCheckpoints(latest, now) : [];
  const draftRequests =
    Math.max(1, input.selectedCount) * AGENT_STEP_REQUESTS.draftsPerChannel;
  const running = (ready: boolean): AgentStepStatus =>
    loading && ready ? "running" : ready ? "ready" : "waiting";

  const read: AgentStep = {
    id: "read",
    owner: "agent",
    title: "Read your product",
    status: input.hasProfile
      ? "done"
      : loading
        ? "running"
        : input.url.trim()
          ? "ready"
          : "needs-you",
    detail: input.hasProfile
      ? `${plural(input.facts.length, "fact")} on record: ${verified} verified, ${unverified} not verified.`
      : input.url.trim()
        ? "Start the analysis below. Only pages you submit are read."
        : "Paste your product URL below to start.",
    modelRequests: input.demo ? 0 : AGENT_STEP_REQUESTS.read,
    view: "input",
  };

  const confirm: AgentStep = {
    id: "confirm",
    owner: "you",
    title: "Confirm the facts and the goal",
    status: !input.hasProfile ? "waiting" : contract ? "done" : "needs-you",
    detail: !input.hasProfile
      ? "Needs the product read first."
      : contract
        ? `Goal set: ${contract.primaryGoal}. ${unverified > 0 ? `${plural(unverified, "fact")} still not verified.` : "All facts verified."}`
        : "Check what the agent found, then say how this experiment will be judged.",
    modelRequests: 0,
    view: "profile",
  };

  const channelReady = input.hasProfile && Boolean(contract);
  const channel: AgentStep = {
    id: "channel",
    owner: "agent",
    title: "Choose one channel to test",
    status: hasStrategy ? "done" : running(channelReady),
    detail: hasStrategy
      ? `${plural(input.strategy?.recommendations.length ?? 0, "channel")} ranked. ${plural(input.selectedCount, "channel")} selected.`
      : channelReady
        ? "Scores every platform against your facts and goal, then recommends one."
        : "Needs your confirmed goal first.",
    modelRequests: input.demo ? 0 : AGENT_STEP_REQUESTS.channel,
    ...(!hasStrategy && channelReady && !loading
      ? { action: "strategy" as const, actionLabel: "Rank my channels" }
      : {}),
    view: hasStrategy ? "strategy" : undefined,
  };

  const draftsReady = hasStrategy && input.selectedCount > 0;
  const drafts: AgentStep = {
    id: "drafts",
    owner: "agent",
    title: "Write the drafts and the schedule",
    status: input.hasResult
      ? "done"
      : hasStrategy && input.selectedCount === 0
        ? "needs-you"
        : running(draftsReady),
    detail: input.hasResult
      ? "Drafts and schedule are ready for your review. Nothing has been posted."
      : hasStrategy && input.selectedCount === 0
        ? "Select at least one channel in the strategy first."
        : draftsReady
          ? "Review the recommended channel first. Running this step is your approval of it."
          : "Needs a ranked channel first.",
    modelRequests: input.demo ? 0 : draftRequests,
    ...(!input.hasResult && draftsReady && !loading
      ? { action: "generate" as const, actionLabel: "Approve the channel and write drafts" }
      : {}),
    view: hasStrategy ? "strategy" : undefined,
  };

  const publish: AgentStep = {
    id: "publish",
    owner: "you",
    title: "Review, edit and post it yourself",
    status: experiments.length > 0 ? "done" : input.hasResult ? "needs-you" : "waiting",
    detail:
      experiments.length > 0
        ? `${plural(experiments.length, "experiment")} recorded as posted by you.`
        : input.hasResult
          ? "The agent never posts. Edit a draft, post it yourself, then record it."
          : "Needs drafts first.",
    modelRequests: 0,
    view: input.hasResult ? "results" : undefined,
  };

  const measure: AgentStep = {
    id: "measure",
    owner: "you",
    title: "Record what happened",
    status: measured
      ? due.length > 0
        ? "needs-you"
        : "done"
      : latest
        ? due.length > 0
          ? "needs-you"
          : "waiting"
        : "waiting",
    detail: !latest
      ? "Needs a posted experiment first."
      : due.length > 0
        ? `The ${due.join(" and ")} check is due. Enter the numbers you see; missing numbers stay blank.`
        : measured
          ? "Results recorded. The verdict comes from your numbers and your goal."
          : "The first check is due 24 hours after you posted.",
    modelRequests: 0,
    view: input.hasResult ? "results" : undefined,
  };

  const task = workspace.weeklyTask;
  const improveReady = input.hasProfile && Boolean(contract);
  const improve: AgentStep = {
    id: "improve",
    owner: "you",
    title: "Pick one product task for this week",
    status:
      task?.status === "verified"
        ? "done"
        : task
          ? "needs-you"
          : improveReady
            ? "ready"
            : "waiting",
    detail: !task
      ? improveReady
        ? "Optional, and available now: the agent proposes one task and you decide."
        : "Needs the confirmed facts and goal first."
      : {
          planning: "Tell the agent the pain, the signal and your hours.",
          proposed: "A proposal is waiting for your review.",
          building: "In development. Copy the Build Brief into your coding agent.",
          verifying: "Record what changed and what you observed.",
          verified: "Verified by you. PostBeacon did not inspect the product.",
        }[task.status],
    modelRequests: 0,
    view: input.hasProfile ? "profile" : undefined,
  };

  const people = outreachSummary(workspace.outreach);
  const reach: AgentStep = {
    id: "reach",
    owner: "you",
    title: "Contact people who described the problem",
    status: !improveReady
      ? "waiting"
      : people.toReview > 0 || people.awaiting > 0
        ? "needs-you"
        : people.sent > 0
          ? "done"
          : "ready",
    detail: !improveReady
      ? "Needs the confirmed facts and goal first."
      : people.total === 0
        ? "Optional, and available now: add someone, the agent drafts the message, you send it."
        : `On the list: ${people.toReview} to review, ${people.awaiting} awaiting a reply, ${people.replied} replied. The agent never sends.`,
    modelRequests: 0,
    view: input.hasProfile ? (input.hasResult ? "results" : "profile") : undefined,
  };

  const path = [read, confirm, channel, drafts, publish, measure];
  const steps = [...path, reach, improve];
  return {
    steps,
    current: path.find((step) => step.status !== "done"),
    doneCount: steps.filter((step) => step.status === "done").length,
    remainingModelRequests: path
      .filter((step) => step.owner === "agent" && step.status !== "done")
      .reduce((sum, step) => sum + step.modelRequests, 0),
  };
}

/* ---------- run several agent steps in a row ---------- */

export type AgentRunStop =
  | "needs-you" // reached a step only the founder can do — the normal ending
  | "failed" // the step reported an error or hit a usage limit
  | "incomplete"; // the step returned without producing its result

export type AgentRunDecision =
  | { kind: "wait" }
  | { kind: "run"; action: AgentAction }
  | { kind: "stop"; reason: AgentRunStop };

/**
 * What a multi-step run does next. It only ever continues into a step the plan
 * itself offers, tries each step once, and stops at the first failure — so a
 * run can spend at most one attempt per agent step and can never loop.
 */
export function nextAgentRunStep(
  plan: AgentPlan,
  attempted: ReadonlySet<AgentAction>,
  flags: { loading: boolean; failed: boolean }
): AgentRunDecision {
  if (flags.loading) return { kind: "wait" };
  // An error left on screen from before the run is not this run's failure.
  if (flags.failed && attempted.size > 0) return { kind: "stop", reason: "failed" };
  const action = plan.current?.action;
  if (!action) return { kind: "stop", reason: "needs-you" };
  if (attempted.has(action)) return { kind: "stop", reason: "incomplete" };
  return { kind: "run", action };
}

/** A run is worth offering only when it would do more than the single-step button. */
export function canRunAhead(plan: AgentPlan): boolean {
  return plan.current?.action === "strategy";
}
