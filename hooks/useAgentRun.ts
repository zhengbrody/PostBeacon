"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  nextAgentRunStep,
  type AgentAction,
  type AgentPlan,
  type AgentRunStop,
} from "@/lib/agentPlan";

/**
 * Runs the plan's agent steps in a row after one explicit start. Every decision
 * is `nextAgentRunStep`; this hook only holds "a run is active" and which steps
 * it already tried. Nothing is stored, so a reload always ends a run.
 */
export function useAgentRun({
  plan,
  loading,
  failed,
  run,
}: {
  plan: AgentPlan;
  loading: boolean;
  failed: boolean;
  run: (action: AgentAction) => void;
}) {
  const [active, setActive] = useState(false);
  const [stopped, setStopped] = useState<AgentRunStop | "by-you" | null>(null);
  const attempted = useRef(new Set<AgentAction>());
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!active) return;
    const decision = nextAgentRunStep(plan, attempted.current, { loading, failed });
    if (decision.kind === "wait") return;
    if (decision.kind === "stop") {
      setActive(false);
      setStopped(decision.reason);
      return;
    }
    attempted.current.add(decision.action);
    runRef.current(decision.action);
  }, [active, plan, loading, failed]);

  const start = useCallback(() => {
    attempted.current = new Set();
    setStopped(null);
    setActive(true);
  }, []);
  /** Ends the run after the step in flight; it does not cancel that request. */
  const stop = useCallback(() => {
    setActive(false);
    setStopped("by-you");
  }, []);

  return { active, stopped, start, stop };
}
