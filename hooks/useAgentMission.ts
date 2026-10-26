"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type {
  AgentMission,
  AgentMissionCommand,
  AgentMissionList,
} from "@/lib/agentMissions";

/** The server owns standing delegations. This hook never persists a local mission
 * or starts work during polling, rendering, retries, or fictional examples. */
export function useAgentMission(
  ownerId: string | null | undefined,
  projectId: string,
  demo: boolean
) {
  const scope = `${ownerId ?? ""}:${projectId}:${demo}`;
  const current = useRef(scope);
  current.current = scope;
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    mission: AgentMission | null;
    enabled: boolean;
    checked: boolean;
    error: string;
  }>({ scope, mission: null, enabled: false, checked: false, error: "" });
  const [busyCommand, setBusyCommand] = useState<{
    scope: string;
    controller: AbortController;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const commandController = useRef<AbortController | null>(null);
  const readController = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    commandController.current?.abort();
    commandController.current = null;
    inFlight.current = false;
  }, [scope]);

  useEffect(() => {
    if (!ownerId || !projectId || demo) return;
    const controller = new AbortController();
    readController.current = controller;
    void api.agentMission(projectId, ownerId, controller.signal).then(
      (response: AgentMissionList) => {
        if (current.current !== scope || controller.signal.aborted) return;
        setSnapshot({ scope, ...response, checked: true, error: "" });
      },
      (failure: unknown) => {
        if (current.current !== scope || controller.signal.aborted) return;
        setSnapshot((previous) => ({
          scope,
          mission: previous.scope === scope ? previous.mission : null,
          enabled: false,
          checked: true,
          error:
            failure instanceof Error
              ? failure.message
              : "Daily research settings could not be loaded.",
        }));
      }
    );
    return () => controller.abort();
  }, [scope, ownerId, projectId, demo, refreshKey]);

  useEffect(() => () => commandController.current?.abort(), []);
  const mission = snapshot.scope === scope ? snapshot.mission : null;
  const enabled = snapshot.scope === scope && snapshot.enabled;
  const command = async (body: AgentMissionCommand) => {
    if (!ownerId || !projectId || demo || inFlight.current) return;
    // Pausing an existing authorization must remain possible when execution is off.
    if (body.action !== "pause" && !enabled) return;
    const capturedScope = scope;
    const controller = new AbortController();
    readController.current?.abort();
    commandController.current?.abort();
    commandController.current = controller;
    inFlight.current = true;
    setBusyCommand({ scope, controller });
    try {
      const response = await api.agentMissionCommand(body, ownerId, controller.signal);
      if (current.current !== capturedScope || controller.signal.aborted) return;
      setSnapshot({
        scope,
        mission: response.mission,
        enabled: response.enabled,
        checked: true,
        error: "",
      });
      return response;
    } catch (failure) {
      if (current.current === capturedScope && !controller.signal.aborted)
        setSnapshot((previous) => ({
          scope,
          mission: previous.scope === scope ? previous.mission : null,
          enabled: previous.scope === scope && previous.enabled,
          checked: true,
          error:
            failure instanceof Error
              ? failure.message
              : "Daily research settings could not be changed.",
        }));
    } finally {
      // A→B→A cannot let an old finally unlock a newer command.
      if (current.current === capturedScope && commandController.current === controller) {
        inFlight.current = false;
        setBusyCommand(null);
      }
    }
  };

  return {
    mission,
    enabled,
    checking: Boolean(
      ownerId && projectId && !demo && (snapshot.scope !== scope || !snapshot.checked)
    ),
    error: snapshot.scope === scope ? snapshot.error : "",
    busy: Boolean(busyCommand?.scope === scope && !busyCommand.controller.signal.aborted),
    refresh,
    command,
  };
}
