"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { AgentRun } from "@/lib/agentRuns";
import type { TrialResearchInput } from "@/lib/types";

/** Remote jobs are authoritative, never localStorage/plan mirror state. Polling
 * only reads server receipts and stops for terminal/interrupted jobs or on error. */
export function useGrowthAgent(
  ownerId: string | null | undefined,
  projectId: string,
  demo: boolean
) {
  const scope = `${ownerId ?? ""}:${projectId}:${demo}`;
  const current = useRef(scope);
  current.current = scope;
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    runs: AgentRun[];
    enabled: boolean;
    checked: boolean;
    error: string;
  }>({ scope, runs: [], enabled: false, checked: false, error: "" });
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const pending = useRef<{ scope: string; fingerprint: string; requestId: string } | null>(
    null
  );
  const inFlight = useRef(false);
  const commands = useRef<AbortController | null>(null);
  const runs = snapshot.scope === scope ? snapshot.runs : [];
  const enabled = snapshot.scope === scope && snapshot.enabled;
  const error = snapshot.scope === scope ? snapshot.error : "";
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    commands.current?.abort();
    pending.current = null;
    inFlight.current = false;
  }, [scope]);

  useEffect(() => {
    const controller = new AbortController();
    if (!ownerId || !projectId || demo) return () => controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reads = 0;
    const load = async () => {
      try {
        const result = await api.agentRuns(projectId, ownerId, controller.signal);
        if (controller.signal.aborted || current.current !== scope) return;
        setSnapshot({ scope, ...result, checked: true, error: "" });
        reads += 1;
        if (
          reads < 35 &&
          result.runs.some(
            (run) =>
              (run.status === "queued" || run.status === "running") && !run.interrupted
          )
        )
          timer = setTimeout(load, 2000);
      } catch (failure) {
        if (!controller.signal.aborted && current.current === scope)
          setSnapshot((prior) => ({
            scope,
            runs: prior.scope === scope ? prior.runs : [],
            enabled: false,
            checked: true,
            error:
              failure instanceof Error
                ? failure.message
                : "Agent tasks could not be loaded.",
          }));
      }
    };
    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [scope, ownerId, projectId, demo, refreshKey]);

  useEffect(() => () => commands.current?.abort(), []);
  const command = async (body: unknown) => {
    if (!ownerId || !projectId || demo || inFlight.current) return;
    const capturedScope = scope;
    const controller = new AbortController();
    commands.current?.abort();
    commands.current = controller;
    inFlight.current = true;
    setBusyScope(scope);
    try {
      const run = await api.agentCommand(body, ownerId, controller.signal);
      if (current.current !== capturedScope || controller.signal.aborted) return;
      setSnapshot((prior) => ({
        scope,
        enabled: true,
        checked: true,
        error: "",
        runs: [
          run,
          ...(prior.scope === scope ? prior.runs.filter((r) => r.id !== run.id) : []),
        ].slice(0, 5),
      }));
      pending.current = null;
      refresh();
    } catch (failure) {
      if (current.current === capturedScope && !controller.signal.aborted)
        setSnapshot((prior) => ({
          scope,
          enabled: prior.scope === scope && prior.enabled,
          checked: true,
          runs: prior.scope === scope ? prior.runs : [],
          error: failure instanceof Error ? failure.message : "Agent task failed.",
        }));
    } finally {
      // A project/account can leave and return to the same scope while an old
      // aborted command settles. Only the current command may release its lock.
      if (current.current === capturedScope && commands.current === controller) {
        inFlight.current = false;
        setBusyScope(null);
      }
    }
  };
  const start = (
    input: TrialResearchInput,
    provider: "openai" | "deepseek",
    contextKey: string,
    deepseekConsent: boolean
  ) => {
    const fingerprint = JSON.stringify({ input, provider, contextKey, deepseekConsent });
    if (pending.current?.scope !== scope || pending.current.fingerprint !== fingerprint)
      pending.current = { scope, fingerprint, requestId: crypto.randomUUID() };
    return command({
      action: "start",
      projectId,
      requestId: pending.current.requestId,
      input,
      provider,
      contextKey,
      deepseekConsent,
    });
  };
  return {
    runs,
    enabled,
    checking: Boolean(
      ownerId && projectId && !demo && (snapshot.scope !== scope || !snapshot.checked)
    ),
    error,
    busy: busyScope === scope,
    refresh,
    start,
    cancel: (runId: string) => command({ action: "cancel", runId }),
    resume: (runId: string) => command({ action: "resume", runId }),
  };
}

export type GrowthAgentControls = ReturnType<typeof useGrowthAgent>;
