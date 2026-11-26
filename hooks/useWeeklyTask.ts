"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import { api } from "@/lib/api";
import {
  applyWeeklyTaskCommand,
  exampleWeeklyTaskProposal,
  type WeeklyTaskCommand,
} from "@/lib/weeklyTask";
import { weeklyTaskContext, type FlowAction, type FlowState } from "./launchFlowReducer";

/** Long enough for one bounded model request; short enough to fail visibly. */
export const WEEKLY_TASK_PLAN_TIMEOUT_MS = 45_000;

/**
 * Async edge of the weekly task. All task state stays in the flow reducer;
 * this hook only owns the in-flight planning request and the message shown
 * when a command is refused. A response is bound to the task id, revision and
 * product version captured BEFORE the request, and the reducer checks all
 * three again — so a late, cancelled or cross-account response cannot land.
 */
export function useWeeklyTask(
  state: FlowState,
  dispatch: Dispatch<FlowAction>,
  ownerId: string | null | undefined,
  openaiAvailable: boolean
) {
  // A request belongs to one task of one project of one account.
  const scope = `${ownerId ?? ""}:${state.projectId}:${state.demo}:${state.workspace.weeklyTask?.id ?? ""}`;
  const live = useRef({ state, scope });
  live.current = { state, scope };
  const [busy, setBusy] = useState<{ scope: string; controller: AbortController } | null>(
    null
  );
  const [message, setMessage] = useState<{ scope: string; text: string } | null>(null);
  const request = useRef<AbortController | null>(null);

  // Account, project, demo or task boundary (including abandon): stop the
  // request so it cannot show as "planning" on whatever comes next.
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
      setBusy(null);
    },
    [scope]
  );

  /** Apply one command. Returns the refusal text (also shown in the card) or null. */
  const send = useCallback(
    (command: WeeklyTaskCommand): string | null => {
      const { state: current, scope: currentScope } = live.current;
      const applied = applyWeeklyTaskCommand(
        current.workspace,
        command,
        weeklyTaskContext(current)
      );
      if (!applied.ok) {
        setMessage({ scope: currentScope, text: applied.refusal });
        return applied.refusal;
      }
      setMessage(null);
      dispatch({ type: "WEEKLY_TASK_COMMAND", projectId: current.projectId, command });
      return null;
    },
    [dispatch]
  );

  const cancelPlanning = useCallback(() => {
    if (!request.current) return;
    request.current.abort();
    request.current = null;
    setBusy(null);
    setMessage({
      scope: live.current.scope,
      text: "Planning cancelled. Your task is unchanged.",
    });
  }, []);

  const plan = useCallback(async () => {
    const { state: source, scope: sourceScope } = live.current;
    const task = source.workspace.weeklyTask;
    if (!task || task.status !== "planning" || request.current) return;
    const captured = {
      taskId: task.id,
      revision: task.revision,
      contextKey: weeklyTaskContext(source).contextKey,
    };
    if (source.demo) {
      send({
        type: "proposal-received",
        ...captured,
        proposal: exampleWeeklyTaskProposal(source.facts),
        source: "example",
        at: new Date().toISOString(),
      });
      return;
    }
    const fail = (text: string) => setMessage({ scope: sourceScope, text });
    if (!source.profile) return fail("Analyze a product before planning a task.");
    if (!ownerId)
      return fail(
        "Sign in to ask the Agent for a proposal — or write the task yourself below."
      );
    if (!openaiAvailable)
      return fail(
        "Agent proposals need OpenAI, which is not configured here. You can write the task yourself below."
      );
    const controller = new AbortController();
    request.current = controller;
    setBusy({ scope: sourceScope, controller });
    setMessage(null);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, WEEKLY_TASK_PLAN_TIMEOUT_MS);
    try {
      const response = await Promise.race([
        api.weeklyTask(
          {
            provider: "openai",
            profile: source.profile,
            facts: source.facts,
            successContract: source.workspace.successContract,
            intake: task.intake,
            bannedClaims: source.memory.bannedClaims,
          },
          ownerId,
          controller.signal
        ),
        // The session lookup inside the client ignores the signal; never let a
        // stalled lookup keep the card "planning" past the timeout or a cancel.
        new Promise<never>((_resolve, reject) =>
          controller.signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          })
        ),
      ]);
      if (controller.signal.aborted || live.current.scope !== sourceScope) return;
      send({
        type: "proposal-received",
        ...captured,
        proposal: response.proposal,
        source: "model",
        meta: response.meta,
        at: new Date().toISOString(),
      });
    } catch (error) {
      if (live.current.scope !== sourceScope) return;
      if (timedOut)
        fail("Planning timed out. Your task is unchanged — retry, or write it yourself.");
      else if (!controller.signal.aborted)
        fail(
          error instanceof Error
            ? error.message
            : "Planning failed. Your task is unchanged."
        );
    } finally {
      clearTimeout(timer);
      if (request.current === controller) {
        request.current = null;
        setBusy(null);
      }
    }
  }, [ownerId, openaiAvailable, send]);

  return {
    task: state.workspace.weeklyTask,
    history: state.workspace.weeklyTaskHistory ?? [],
    context: weeklyTaskContext(state),
    planning: busy?.scope === scope,
    message: message?.scope === scope ? message.text : "",
    canAskAgent: state.demo || (Boolean(ownerId) && openaiAvailable),
    send,
    plan,
    cancelPlanning,
    dismissMessage: () => setMessage(null),
  };
}

export type WeeklyTaskController = ReturnType<typeof useWeeklyTask>;
