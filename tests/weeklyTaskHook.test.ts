// @vitest-environment jsdom
import { act, useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flowReducer, initialFlowState } from "@/hooks/launchFlowReducer";
import { useWeeklyTask, WEEKLY_TASK_PLAN_TIMEOUT_MS } from "@/hooks/useWeeklyTask";
import { DEMO_PROJECT } from "@/lib/demo";
import { trialProductFacts } from "@/lib/opportunityResearch";
import { deferred, mountHook } from "./helpers/reactHook";
import type { WeeklyTaskProposalResponse } from "@/lib/weeklyTaskServer";

const calls = vi.hoisted(() => ({ weeklyTask: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: calls }));

const AT = "2026-11-16T10:00:00.000Z";
const intake = {
  pain: "Visitors do not know what to do first",
  successSignal: "Three people finish the first task",
  hoursAvailable: 4,
};
const response = (): WeeklyTaskProposalResponse => ({
  proposal: {
    kind: "product-improvement",
    title: "Add a sample project",
    rationale: "The first screen is empty for new visitors.",
    factIds: [trialProductFacts(DEMO_PROJECT.facts)[0].id],
    minimalScope: ["Show one sample"],
    assumptions: [],
    nonGoals: [],
    acceptance: ["A visitor sees the sample"],
    tests: ["Cover the empty state"],
    unknowns: [],
  },
  meta: { provider: "openai", model: "test-model" },
});

type Props = { owner: string | null; demo?: boolean; openai?: boolean };
async function mount(props: Props) {
  const base = flowReducer(initialFlowState, {
    type: "PROJECT_LOADED",
    project: { ...DEMO_PROJECT, id: "project-a" },
    demo: props.demo ?? false,
  });
  const hook = await mountHook((p: Props) => {
    const [state, dispatch] = useReducer(flowReducer, base);
    return {
      state,
      dispatch,
      ...useWeeklyTask(state, dispatch, p.owner, p.openai ?? true),
    };
  }, props);
  await act(async () => {
    hook.current.send({ type: "intake-saved", id: "task-1", intake, at: AT });
  });
  return hook;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("weekly task planning request", () => {
  it("stores a model proposal bound to the owner and marks it for confirmation", async () => {
    calls.weeklyTask.mockResolvedValue(response());
    const hook = await mount({ owner: "owner-a" });
    await act(async () => hook.current.plan());
    expect(calls.weeklyTask).toHaveBeenCalledTimes(1);
    expect(calls.weeklyTask.mock.calls[0][1]).toBe("owner-a"); // expectedUserId
    expect(calls.weeklyTask.mock.calls[0][0].intake).toEqual(intake);
    expect(hook.current.task?.status).toBe("proposed");
    expect(hook.current.task?.proposalSource).toBe("model");
    expect(hook.current.planning).toBe(false);
    await hook.unmount();
  });
  it("cancel aborts the request and a late response changes nothing", async () => {
    const gate = deferred<WeeklyTaskProposalResponse>();
    calls.weeklyTask.mockReturnValue(gate.promise);
    const hook = await mount({ owner: "owner-a" });
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = hook.current.plan();
    });
    expect(hook.current.planning).toBe(true);
    const signal: AbortSignal = calls.weeklyTask.mock.calls[0][2];
    await act(async () => hook.current.cancelPlanning());
    expect(signal.aborted).toBe(true);
    expect(hook.current.planning).toBe(false);
    expect(hook.current.message).toMatch(/cancelled/i);
    await act(async () => {
      gate.resolve(response());
      await pending;
    });
    expect(hook.current.task?.status).toBe("planning");
    await hook.unmount();
  });
  it("times out visibly and leaves the task unchanged", async () => {
    vi.useFakeTimers();
    calls.weeklyTask.mockImplementation(
      (_body: unknown, _owner: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")))
        )
    );
    const hook = await mount({ owner: "owner-a" });
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = hook.current.plan();
    });
    await act(async () => {
      vi.advanceTimersByTime(WEEKLY_TASK_PLAN_TIMEOUT_MS + 1);
      await pending;
    });
    expect(hook.current.planning).toBe(false);
    expect(hook.current.message).toMatch(/timed out/i);
    expect(hook.current.task?.status).toBe("planning");
    await hook.unmount();
  });
  it("drops a response that arrives after the account changed", async () => {
    const gate = deferred<WeeklyTaskProposalResponse>();
    calls.weeklyTask.mockReturnValue(gate.promise);
    const hook = await mount({ owner: "owner-a" });
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = hook.current.plan();
    });
    const signal: AbortSignal = calls.weeklyTask.mock.calls[0][2];
    await hook.render({ owner: "owner-b" });
    expect(signal.aborted).toBe(true);
    expect(hook.current.planning).toBe(false);
    await act(async () => {
      gate.resolve(response());
      await pending;
    });
    expect(hook.current.task?.status).toBe("planning");
    expect(hook.current.message).toBe("");
    // Back on the first account the card is not stuck busy.
    await hook.render({ owner: "owner-a" });
    expect(hook.current.planning).toBe(false);
    await hook.unmount();
  });
  it("abandoning mid-request aborts it, and the next task does not look busy", async () => {
    const gate = deferred<WeeklyTaskProposalResponse>();
    calls.weeklyTask.mockReturnValue(gate.promise);
    const hook = await mount({ owner: "owner-a" });
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = hook.current.plan();
    });
    const signal: AbortSignal = calls.weeklyTask.mock.calls[0][2];
    await act(async () => {
      hook.current.send({ type: "abandoned", taskId: "task-1", at: AT });
    });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      hook.current.send({ type: "intake-saved", id: "task-2", intake, at: AT });
    });
    expect(hook.current.task?.id).toBe("task-2");
    expect(hook.current.planning).toBe(false);
    await act(async () => {
      gate.resolve(response());
      await pending;
    });
    expect(hook.current.task?.status).toBe("planning");
    expect(hook.current.message).toBe(""); // no error for something the user did not do
    // The new task can be planned straight away.
    calls.weeklyTask.mockResolvedValue(response());
    await act(async () => hook.current.plan());
    expect(calls.weeklyTask).toHaveBeenCalledTimes(2);
    expect(hook.current.task?.status).toBe("proposed");
    await hook.unmount();
  });
  it("times out even when the request never observes the abort signal", async () => {
    vi.useFakeTimers();
    calls.weeklyTask.mockReturnValue(new Promise(() => undefined)); // stalled session lookup
    const hook = await mount({ owner: "owner-a" });
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = hook.current.plan();
    });
    await act(async () => {
      vi.advanceTimersByTime(WEEKLY_TASK_PLAN_TIMEOUT_MS + 1);
      await pending;
    });
    expect(hook.current.planning).toBe(false);
    expect(hook.current.message).toMatch(/timed out/i);
    await hook.unmount();
  });
  it("discards a response when the inputs were edited while it was in flight", async () => {
    const gate = deferred<WeeklyTaskProposalResponse>();
    calls.weeklyTask.mockReturnValue(gate.promise);
    const hook = await mount({ owner: "owner-a" });
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = hook.current.plan();
    });
    await act(async () => {
      hook.current.send({
        type: "intake-saved",
        id: "task-1",
        revision: hook.current.task!.revision,
        intake: { ...intake, hoursAvailable: 1 },
        at: AT,
      });
    });
    await act(async () => {
      gate.resolve(response());
      await pending;
    });
    expect(hook.current.task?.status).toBe("planning");
    expect(hook.current.task?.intake.hoursAvailable).toBe(1);
    expect(hook.current.message).toMatch(/changed/i);
    await hook.unmount();
  });
  it("surfaces a server failure and never fabricates a proposal", async () => {
    calls.weeklyTask.mockRejectedValue(
      new Error("No grounded proposal. Your task is unchanged.")
    );
    const hook = await mount({ owner: "owner-a" });
    await act(async () => hook.current.plan());
    expect(hook.current.message).toMatch(/unchanged/);
    expect(hook.current.task?.proposal).toBeUndefined();
    await hook.unmount();
  });
  it("makes no request when signed out or without OpenAI, and says why", async () => {
    const signedOut = await mount({ owner: null });
    await act(async () => signedOut.current.plan());
    expect(signedOut.current.canAskAgent).toBe(false);
    expect(signedOut.current.message).toMatch(/sign in/i);
    await signedOut.unmount();
    const noProvider = await mount({ owner: "owner-a", openai: false });
    await act(async () => noProvider.current.plan());
    expect(noProvider.current.message).toMatch(/OpenAI/);
    await noProvider.unmount();
    expect(calls.weeklyTask).not.toHaveBeenCalled();
  });
  it("the demo uses a code-written fictional proposal with no API call", async () => {
    const hook = await mount({ owner: null, demo: true });
    await act(async () => hook.current.plan());
    expect(calls.weeklyTask).not.toHaveBeenCalled();
    expect(hook.current.task?.proposalSource).toBe("example");
    expect(hook.current.task?.example).toBe(true);
    await hook.unmount();
  });
  it("returns the refusal text for a duplicate confirmation", async () => {
    calls.weeklyTask.mockResolvedValue(response());
    const hook = await mount({ owner: "owner-a" });
    await act(async () => hook.current.plan());
    const confirm = {
      type: "confirmed" as const,
      taskId: "task-1",
      revision: hook.current.task!.revision,
      at: AT,
    };
    let first: string | null = "";
    let second: string | null = "";
    await act(async () => {
      first = hook.current.send(confirm);
    });
    await act(async () => {
      second = hook.current.send(confirm);
    });
    expect(first).toBeNull();
    expect(second).toMatch(/changed since/);
    expect(hook.current.task?.status).toBe("building");
    await hook.unmount();
  });
});
