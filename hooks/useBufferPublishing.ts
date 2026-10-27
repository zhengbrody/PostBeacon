"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type {
  BufferConnectionCommand,
  BufferConnectionList,
} from "@/lib/bufferConnections";
import type { BufferDelivery, BufferDeliveryCommand } from "@/lib/bufferPublishing";

/** Server-owned connection/approval receipts only. Reading or returning to the
 * app never connects, refreshes a token, approves or sends a post. */
export function useBufferPublishing(
  ownerId: string | null | undefined,
  projectId: string,
  demo: boolean
) {
  const scope = `${ownerId ?? ""}:${projectId}:${demo}`;
  const current = useRef(scope);
  current.current = scope;
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    checked: boolean;
    enabled: boolean;
    connection: BufferConnectionList["connection"];
    deliveries: BufferDelivery[];
    setupIssues: string[];
    error: string;
  }>({
    scope,
    checked: false,
    enabled: false,
    connection: null,
    deliveries: [],
    setupIssues: [],
    error: "",
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, setPending] = useState<{
    scope: string;
    controller: AbortController;
  } | null>(null);
  const commandController = useRef<AbortController | null>(null);
  const readController = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    commandController.current?.abort();
    commandController.current = null;
    locked.current = false;
    return () => commandController.current?.abort();
  }, [scope]);

  useEffect(() => {
    if (!ownerId || !projectId || demo) return;
    const controller = new AbortController();
    readController.current = controller;
    void Promise.allSettled([
      api.bufferConnections(ownerId, controller.signal),
      api.bufferDeliveries(projectId, ownerId, controller.signal),
    ]).then(([connections, deliveries]) => {
      if (controller.signal.aborted || current.current !== scope) return;
      setSnapshot((prior) => ({
        scope,
        checked: true,
        enabled:
          connections.status === "fulfilled" &&
          deliveries.status === "fulfilled" &&
          connections.value.enabled &&
          deliveries.value.enabled,
        connection:
          connections.status === "fulfilled"
            ? connections.value.connection
            : prior.scope === scope
              ? prior.connection
              : null,
        deliveries:
          deliveries.status === "fulfilled"
            ? deliveries.value.deliveries
            : prior.scope === scope
              ? prior.deliveries
              : [],
        setupIssues:
          connections.status === "fulfilled" ? connections.value.setupIssues : [],
        error:
          connections.status === "rejected" || deliveries.status === "rejected"
            ? "Publishing settings or receipts could not be read completely. Scheduling is disabled; you can still disconnect an existing connection or refresh."
            : "",
      }));
    });
    return () => controller.abort();
  }, [scope, ownerId, projectId, demo, refreshKey]);

  useEffect(() => {
    if (!ownerId || !projectId || demo) return;
    let last = 0;
    const onReturn = () => {
      if (
        document.visibilityState === "hidden" ||
        locked.current ||
        Date.now() - last < 1000
      )
        return;
      last = Date.now();
      refresh();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [ownerId, projectId, demo, refresh]);

  async function command<T>(
    run: (signal: AbortSignal) => Promise<T>,
    apply: (result: T) => void
  ): Promise<T | undefined> {
    if (!ownerId || !projectId || demo || locked.current) return;
    const captured = scope,
      controller = new AbortController();
    commandController.current?.abort();
    readController.current?.abort();
    commandController.current = controller;
    locked.current = true;
    setPending({ scope, controller });
    try {
      const result = await run(controller.signal);
      if (controller.signal.aborted || current.current !== captured) return;
      apply(result);
      return result;
    } catch (failure) {
      if (!controller.signal.aborted && current.current === captured)
        setSnapshot((prior) => ({
          ...(prior.scope === scope
            ? prior
            : {
                scope,
                checked: true,
                enabled: false,
                connection: null,
                deliveries: [],
                setupIssues: [],
              }),
          error:
            failure instanceof Error
              ? failure.message
              : "The publishing operation stopped. Refresh its receipt before trying again.",
        }));
    } finally {
      if (current.current === captured && commandController.current === controller) {
        locked.current = false;
        setPending(null);
      }
    }
  }

  const connectionCommand = (body: BufferConnectionCommand) =>
    command(
      (signal) => api.bufferConnectionCommand(body, ownerId!, signal),
      (result) => {
        setSnapshot((prior) => ({
          ...prior,
          scope,
          checked: true,
          deliveries: prior.scope === scope ? prior.deliveries : [],
          connection: result.connection,
          enabled: false,
          setupIssues: result.setupIssues,
          error: "",
        }));
        refresh();
      }
    );
  const deliveryCommand = (body: BufferDeliveryCommand) =>
    command(
      (signal) => api.bufferDeliveryCommand(body, ownerId!, signal),
      (result) =>
        setSnapshot((prior) => ({
          ...prior,
          scope,
          checked: true,
          error: "",
          connection: prior.scope === scope ? prior.connection : null,
          enabled: result.enabled && prior.scope === scope && prior.enabled,
          setupIssues: prior.scope === scope ? prior.setupIssues : [],
          deliveries: [
            result.delivery,
            ...(prior.scope === scope
              ? prior.deliveries.filter((item) => item.id !== result.delivery.id)
              : []),
          ].slice(0, 20),
        }))
    );
  const state =
    snapshot.scope === scope
      ? snapshot
      : {
          enabled: false,
          connection: null,
          deliveries: [],
          setupIssues: [],
          error: "",
          checked: false,
        };
  return {
    ...state,
    checking: Boolean(ownerId && projectId && !demo && !state.checked),
    busy: Boolean(pending?.scope === scope && !pending.controller.signal.aborted),
    refresh,
    connectionCommand,
    deliveryCommand,
  };
}
