"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import { api } from "@/lib/api";
import {
  applyOutreachCommand,
  exampleOutreachMessage,
  outreachModelInput,
  outreachSuggestions,
  outreachSummary,
  type OutreachCommand,
} from "@/lib/outreach";
import type { FlowAction, FlowState } from "./launchFlowReducer";

export const OUTREACH_DRAFT_TIMEOUT_MS = 45_000;

/**
 * Async edge of outreach. The list lives in the flow reducer; this hook owns
 * only the one in-flight drafting request and the refusal text. A draft is
 * applied per contact against the revision captured BEFORE the request, so a
 * late response cannot overwrite an edit, a removed contact or another account.
 */
export function useOutreach(
  state: FlowState,
  dispatch: Dispatch<FlowAction>,
  ownerId: string | null | undefined,
  openaiAvailable: boolean
) {
  const scope = `${ownerId ?? ""}:${state.projectId}:${state.demo}`;
  const live = useRef({ state, scope });
  live.current = { state, scope };
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ scope: string; text: string } | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
      setBusy(null);
    },
    [scope]
  );

  const send = useCallback(
    (command: OutreachCommand): string | null => {
      const { state: current, scope: currentScope } = live.current;
      const applied = applyOutreachCommand(current.workspace, command, {
        facts: current.facts,
        profile: current.profile,
      });
      if (!applied.ok) {
        setMessage({ scope: currentScope, text: applied.refusal });
        return applied.refusal;
      }
      setMessage(null);
      dispatch({ type: "OUTREACH_COMMAND", projectId: current.projectId, command });
      return null;
    },
    [dispatch]
  );

  const draft = useCallback(async () => {
    const { state: source, scope: sourceScope } = live.current;
    if (request.current) return;
    const fail = (text: string) => setMessage({ scope: sourceScope, text });
    const people = outreachModelInput(
      (source.workspace.outreach ?? []).map((c) =>
        source.demo ? { ...c, example: false } : c
      )
    );
    if (!people.length) return fail("Everyone on the list already has a message.");
    if (source.demo) {
      const at = new Date().toISOString();
      for (const person of people)
        send({
          type: "draft-received",
          contactId: person.contactId,
          revision: person.revision,
          message: exampleOutreachMessage(source.profile?.name ?? "this product"),
          factIds: [],
          source: "example",
          at,
        });
      return;
    }
    if (!source.profile) return fail("Analyze a product before drafting messages.");
    if (!ownerId)
      return fail("Sign in to have the agent draft messages, or write them yourself.");
    if (!source.projectId)
      return fail("Your project is still being saved. Try again in a moment.");
    if (!openaiAvailable)
      return fail(
        "Drafting needs OpenAI, which is not configured here. You can write the messages yourself."
      );
    const controller = new AbortController();
    request.current = controller;
    setBusy(sourceScope);
    setMessage(null);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, OUTREACH_DRAFT_TIMEOUT_MS);
    try {
      const response = await Promise.race([
        api.outreach(
          {
            provider: "openai",
            profile: source.profile,
            facts: source.facts,
            successContract: source.workspace.successContract,
            ...(source.url.trim() ? { productUrl: source.url.trim() } : {}),
            people: people.map(({ alias, need }) => ({ alias, need })),
            bannedClaims: source.memory.bannedClaims,
          },
          ownerId,
          controller.signal
        ),
        new Promise<never>((_resolve, reject) =>
          controller.signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          })
        ),
      ]);
      if (controller.signal.aborted || live.current.scope !== sourceScope) return;
      const at = new Date().toISOString();
      let applied = 0;
      for (const item of response.drafts) {
        const person = people.find((p) => p.alias === item.alias);
        if (!person) continue;
        const refusal = send({
          type: "draft-received",
          contactId: person.contactId,
          revision: person.revision,
          message: item.message,
          factIds: item.factIds,
          source: "agent",
          at,
        });
        if (!refusal) applied += 1;
      }
      const skipped = people.length - applied;
      setMessage(
        skipped > 0
          ? {
              scope: sourceScope,
              text: `${applied} of ${people.length} drafted. The rest were left for you: the need did not match the product, or you changed the contact meanwhile.`,
            }
          : null
      );
    } catch (error) {
      if (live.current.scope !== sourceScope) return;
      if (timedOut) fail("Drafting timed out. Your list is unchanged.");
      else if (!controller.signal.aborted)
        fail(
          error instanceof Error
            ? error.message
            : "Drafting failed. Your list is unchanged."
        );
    } finally {
      clearTimeout(timer);
      if (request.current === controller) {
        request.current = null;
        setBusy(null);
      }
    }
  }, [ownerId, openaiAvailable, send]);

  const contacts = state.workspace.outreach ?? [];
  return {
    contacts,
    summary: outreachSummary(contacts),
    suggestions: outreachSuggestions(state.workspace.opportunityResearch, contacts),
    facts: state.facts,
    profile: state.profile,
    demo: state.demo,
    drafting: busy === scope,
    message: message?.scope === scope ? message.text : "",
    canAskAgent: state.demo || (Boolean(ownerId) && openaiAvailable),
    send,
    draft,
    dismissMessage: () => setMessage(null),
  };
}

export type OutreachController = ReturnType<typeof useOutreach>;
