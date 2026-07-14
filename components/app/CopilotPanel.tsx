"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { api, type ApiError } from "@/lib/api";
import { PROVIDER_PRIVACY, providerFallbackNotice } from "@/lib/privacy";
import { buildBriefing, type Briefing } from "@/lib/today";
import {
  applyKindOf,
  impactOf,
  isDestructive,
  type ActionContext,
} from "@/lib/copilotActions";
import { PublishDialog, type PublishDetails } from "@/components/app/results/PublishDialog";
import { OutcomePanel } from "@/components/app/results/OutcomePanel";
import type {
  CopilotAction,
  Experiment,
  Fact,
  GenerateResult,
  MarketingStrategy,
  Outcome,
  OutcomeCheckpoint,
  ProductMemory,
  ProductProfile,
  ProposedAction,
  Provider,
  WorkspaceState,
} from "@/lib/types";

/**
 * The Launch Copilot panel (M16): a CMO action engine, not a chat box.
 * The model only ever PROPOSES — every proposal renders as a card with the
 * diff, rationale, verified evidence and impact; nothing touches the plan
 * until the founder confirms (destructive ones confirm twice). Opening the
 * panel starts with a deterministic briefing computed from the plan itself.
 */

interface PanelMessage {
  role: "user" | "assistant";
  content: string;
  actions?: ProposedAction[];
  briefing?: Briefing; // deterministic opener — no model call behind it
  providerNote?: string;
}

export interface CopilotOpenRequest {
  id: number;
  prompt: string;
}

const QUICK_ACTIONS: { label: string; action: CopilotAction }[] = [
  { label: "Explain this plan", action: "explain-plan" },
  { label: "What's next?", action: "next-steps" },
  { label: "De-AI my posts", action: "improve-posts" },
];

const TOOL_LABELS: Record<ProposedAction["tool"], string> = {
  ask_clarifying_question: "Question for you",
  propose_next_actions: "Proposed next steps",
  update_positioning: "Update positioning",
  update_channel_priority: "Change channel priority",
  create_experiment: "Prepare an experiment",
  generate_variant: "New draft variant",
  record_outcome: "Record results",
  diagnose_outcome: "Diagnosis",
  stop_or_continue_channel: "Channel call",
};

export function CopilotPanel({
  profile,
  strategy,
  result,
  facts,
  workspace,
  memory,
  launchDate,
  provider,
  loading,
  onAuthRequired,
  applyAction,
  rejectAction,
  auditBlocked,
  setTone,
  addBannedClaim,
  removeBannedClaim,
  publishExperiment,
  recordOutcome,
  stopExperiment,
  generateVariant,
  onProviderFallback,
  openRequest,
}: {
  profile: ProductProfile;
  strategy: MarketingStrategy;
  result: GenerateResult;
  facts: Fact[];
  workspace: WorkspaceState;
  memory: ProductMemory;
  launchDate: string;
  provider: Provider;
  loading: boolean;
  onAuthRequired: () => void;
  applyAction: (a: ProposedAction) => ReturnType<typeof applyKindOf>;
  rejectAction: (a: ProposedAction) => void;
  auditBlocked: (count: number) => void;
  setTone: (tone?: string) => void;
  addBannedClaim: (claim: string) => void;
  removeBannedClaim: (idx: number) => void;
  publishExperiment: (experiment: Experiment, taskId?: string) => void;
  recordOutcome: (experimentId: string, outcome: Outcome) => void;
  stopExperiment: (experimentId: string) => void;
  generateVariant: (experiment: Experiment) => void;
  onProviderFallback: (provider: Provider) => void;
  openRequest?: CopilotOpenRequest | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [target, setTarget] = useState(result.content[0]?.platformId ?? "");
  const [msgs, setMsgs] = useState<PanelMessage[]>([]);
  const [decisions, setDecisions] = useState<Record<string, "applied" | "rejected">>({});
  const [view, setView] = useState<"chat" | "memory" | "audit">("chat");
  const [publishFor, setPublishFor] = useState<{
    platformId: string;
    postIdx: number;
    community?: string;
    angle?: string;
    hypothesis?: string;
  } | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<{
    experimentId: string;
    checkpoint: OutcomeCheckpoint;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const handledOpenRequest = useRef<number | null>(null);

  const ctx: ActionContext = {
    strategy,
    result,
    facts,
    workspace,
    memory,
    launchDate,
  };

  // Regenerate can reshuffle channels — never point at a platform that's gone.
  const validTarget = result.content.some((c) => c.platformId === target)
    ? target
    : (result.content[0]?.platformId ?? "");
  const targetName =
    result.content.find((c) => c.platformId === validTarget)?.platformName || validTarget;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // The command center can open Copilot already scoped to its primary move.
  // Prefill rather than auto-send so the founder remains in control of the call.
  useEffect(() => {
    if (!openRequest || handledOpenRequest.current === openRequest.id) return;
    handledOpenRequest.current = openRequest.id;
    setOpen(true);
    setView("chat");
    setFeedbackMode(false);
    setInput(openRequest.prompt);
  }, [openRequest]);

  // Proactive opener: a deterministic briefing computed from the plan —
  // instant, costless, and it can't hallucinate.
  useEffect(() => {
    if (!open || msgs.length > 0) return;
    const briefing = buildBriefing({ launchDate, strategy, result, workspace }, new Date());
    setMsgs([{ role: "assistant", content: briefing.lines.join("\n"), briefing }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, busy]);

  async function send(action: CopilotAction, label: string, question?: string) {
    if (busy) return;
    const history = msgs
      .filter((m) => !m.briefing)
      .slice(-6)
      .map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: "user", content: label }]);
    setBusy(true);
    setError("");
    try {
      const res = await api.copilot({
        provider,
        profile,
        strategy,
        result,
        facts,
        workspace,
        memory,
        launchDate,
        action,
        question,
        targetPlatformId:
          action === "rewrite" || action === "first-replies" ? validTarget : undefined,
        history,
      });
      const providerNote = res.meta?.fallbackFrom
        ? `${PROVIDER_PRIVACY[res.meta.fallbackFrom].label} was unavailable. Completed with ${PROVIDER_PRIVACY[res.meta.provider].label}; future requests will use it as primary.`
        : undefined;
      if (res.meta?.fallbackFrom) onProviderFallback(res.meta.provider);
      auditBlocked(res.blocked);
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          content: res.reply,
          actions: res.actions,
          providerNote,
        },
      ]);
    } catch (e) {
      const err = e as ApiError;
      if (err?.code === "auth") {
        // Withdraw the optimistic turn and hand off to the sign-in modal.
        setMsgs((m) => m.slice(0, -1));
        onAuthRequired();
      } else {
        setError(err?.message || "Copilot failed");
      }
    } finally {
      setBusy(false);
    }
  }

  function submitFree() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    send(feedbackMode ? "review-feedback" : "ask", q, q);
  }

  function handleApply(a: ProposedAction) {
    const kind = applyAction(a);
    setDecisions((d) => ({ ...d, [a.id]: "applied" }));
    if (kind === "open-publish" && a.tool === "create_experiment") {
      setPublishFor({
        platformId: a.platformId,
        postIdx: a.postIdx ?? 0,
        community: a.community,
        angle: a.angle,
        hypothesis: a.hypothesis,
      });
    } else if (kind === "open-outcome" && a.tool === "record_outcome") {
      setOutcomeFor({ experimentId: a.experimentId, checkpoint: a.checkpoint });
    } else if (kind === "rewrite-call" && a.tool === "generate_variant") {
      // Direction-only variant: run the dedicated rewrite call (platform
      // persona + anti-AI rules) — the result comes back as a content card.
      send("rewrite", `Write the variant for ${a.platformId}`, a.direction || undefined);
    }
  }

  function handleReject(a: ProposedAction) {
    rejectAction(a);
    setDecisions((d) => ({ ...d, [a.id]: "rejected" }));
  }

  const publishContent = publishFor
    ? result.content.find((c) => c.platformId === publishFor.platformId)
    : undefined;
  const outcomeExperiment = outcomeFor
    ? workspace.experiments.find((e) => e.id === outcomeFor.experimentId)
    : undefined;

  function confirmPublish(details: PublishDetails) {
    if (!publishContent || !publishFor) return;
    publishExperiment(
      {
        id: crypto.randomUUID(),
        platformId: publishContent.platformId,
        platformName: publishContent.platformName,
        community: details.community,
        angle: details.angle,
        variant: details.variant,
        hypothesis:
          publishFor.hypothesis ||
          `"${details.angle}" on ${details.community || publishContent.platformName} will produce ${
            profile.conversionGoal || "conversion"
          } signal within 72h`,
        trackedUrl: details.trackedUrl || undefined,
        publishedAt: new Date().toISOString(),
        status: "live",
        postIdx: details.postIdx,
        outcomes: [],
      },
      `post:${publishContent.platformId}`
    );
    setPublishFor(null);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="no-print fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-accent-600 px-3 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent-600/25 transition-colors hover:bg-accent-500 sm:bottom-6 sm:right-6 sm:px-4"
      >
        ✦ <span className="hidden sm:inline">Ask your CMO</span>
        <span className="sm:hidden">Copilot</span>
      </button>
    );
  }

  return (
    <div className="no-print">
      <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setOpen(false)} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-surface">
        <header className="border-b border-line px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">
                Launch Copilot <span className="text-accent-400">· {profile.name}</span>
              </div>
              <div className="text-xs text-neutral-500">
                Proposes, never posts — you confirm every change
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close copilot"
              className="rounded-md px-2 py-1 text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 flex gap-1.5 text-xs">
            {(["chat", "memory", "audit"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-full px-2.5 py-1 capitalize transition-colors ${
                  view === v
                    ? "bg-accent-600/20 text-accent-200"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {v}
                {v === "audit" && workspace.auditLog?.length
                  ? ` (${workspace.auditLog.length})`
                  : ""}
              </button>
            ))}
          </div>
        </header>

        {view === "memory" && (
          <MemoryView
            memory={memory}
            setTone={setTone}
            addBannedClaim={addBannedClaim}
            removeBannedClaim={removeBannedClaim}
          />
        )}

        {view === "audit" && <AuditView workspace={workspace} />}

        {view === "chat" && (
          <>
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {msgs.map((m, i) =>
                m.role === "user" ? (
                  <div
                    key={i}
                    className="ml-8 rounded-lg bg-surface-2 px-3 py-2 text-sm text-neutral-200"
                  >
                    {m.content}
                  </div>
                ) : (
                  <div key={i} className="space-y-3">
                    {m.briefing && (
                      <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">
                        Briefing — computed from your plan, no model involved
                      </div>
                    )}
                    {m.content && (
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-neutral-200">
                        {m.content}
                      </pre>
                    )}
                    {m.providerNote && (
                      <div className="rounded-md border border-amber-800/50 bg-amber-950/30 px-2.5 py-2 text-[11px] leading-relaxed text-amber-300">
                        {m.providerNote}
                      </div>
                    )}
                    {m.briefing && m.briefing.chips.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.briefing.chips.map((c, j) => (
                          <Button
                            key={j}
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => send("ask", c.label, c.prompt)}
                          >
                            {c.label}
                          </Button>
                        ))}
                      </div>
                    )}
                    {m.actions?.map((a) => (
                      <ActionCard
                        key={a.id}
                        action={a}
                        ctx={ctx}
                        decision={decisions[a.id]}
                        busy={busy || loading}
                        onApply={() => handleApply(a)}
                        onReject={() => handleReject(a)}
                        onAnswer={(text) => send("ask", text, text)}
                      />
                    ))}
                  </div>
                )
              )}
              {busy && (
                <div className="flex items-center gap-2 text-sm text-accent-300">
                  <Spinner /> Thinking through your plan…
                </div>
              )}
              {error && (
                <div className="rounded-md bg-red-950/60 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}
            </div>

            <div className="space-y-2.5 border-t border-line px-4 py-3">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_ACTIONS.map((qa) => (
                  <Button
                    key={qa.action}
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => send(qa.action, qa.label)}
                  >
                    {qa.label}
                  </Button>
                ))}
                {result.content.length > 0 && (
                  <>
                    <select
                      value={validTarget}
                      onChange={(e) => setTarget(e.target.value)}
                      aria-label="Target platform"
                      className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs text-neutral-100 outline-none transition-colors focus:border-accent-500"
                    >
                      {result.content.map((c) => (
                        <option key={c.platformId} value={c.platformId}>
                          {c.platformName}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !validTarget}
                      onClick={() => {
                        const direction = input.trim();
                        setInput("");
                        send(
                          "rewrite",
                          direction
                            ? `Rewrite for ${targetName}: ${direction}`
                            : `Rewrite for ${targetName}`,
                          direction || undefined
                        );
                      }}
                    >
                      Rewrite
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !validTarget}
                      onClick={() =>
                        send("first-replies", `First replies for ${targetName}`)
                      }
                    >
                      First replies
                    </Button>
                  </>
                )}
              </div>
              <textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitFree();
                  }
                }}
                placeholder={
                  feedbackMode
                    ? "Paste the comments / results you got…"
                    : "Ask about this launch, or give a rewrite direction…"
                }
                className="w-full resize-none rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors focus:border-accent-500"
              />
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                  <input
                    type="checkbox"
                    checked={feedbackMode}
                    onChange={(e) => setFeedbackMode(e.target.checked)}
                  />
                  I&apos;m pasting feedback I got
                </label>
                <Button size="sm" disabled={busy || !input.trim()} onClick={submitFree}>
                  Send
                </Button>
              </div>
              {feedbackMode && (
                <p
                  className={`text-[11px] leading-relaxed ${
                    PROVIDER_PRIVACY[provider].clearPolicy
                      ? "text-neutral-500"
                      : "text-amber-400/90"
                  }`}
                >
                  Pasted text is sent to {PROVIDER_PRIVACY[provider].label} to be analyzed —
                  leave out names, emails, or anything confidential.
                  {!PROVIDER_PRIVACY[provider].clearPolicy &&
                    ` ${PROVIDER_PRIVACY[provider].note}`}
                </p>
              )}
              <p className="text-[10px] leading-relaxed text-neutral-600">
                {providerFallbackNotice()}
              </p>
            </div>
          </>
        )}
      </aside>

      {publishFor && publishContent && (
        <PublishDialog
          content={publishContent}
          rec={strategy.recommendations.find((r) => r.platformId === publishFor.platformId)}
          defaultPostIdx={publishFor.postIdx}
          initialCommunity={publishFor.community}
          initialAngle={publishFor.angle}
          onConfirm={confirmPublish}
          onClose={() => setPublishFor(null)}
        />
      )}

      {outcomeFor && outcomeExperiment && (
        <OutcomePanel
          experiment={outcomeExperiment}
          checkpoint={outcomeFor.checkpoint}
          strategy={strategy}
          loading={loading}
          onSave={(outcome) => recordOutcome(outcomeExperiment.id, outcome)}
          onGenerateVariant={() => generateVariant(outcomeExperiment)}
          onStop={() => stopExperiment(outcomeExperiment.id)}
          onClose={() => setOutcomeFor(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** One proposal: what it does, why, on what evidence — and the confirm gate. */
function ActionCard({
  action,
  ctx,
  decision,
  busy,
  onApply,
  onReject,
  onAnswer,
}: {
  action: ProposedAction;
  ctx: ActionContext;
  decision?: "applied" | "rejected";
  busy: boolean;
  onApply: () => void;
  onReject: () => void;
  onAnswer: (text: string) => void;
}) {
  const [armed, setArmed] = useState(false); // destructive second confirm
  const destructive = isDestructive(action, ctx);
  const informational =
    action.tool === "diagnose_outcome" ||
    (action.tool === "stop_or_continue_channel" && action.decision === "continue");

  return (
    <div className="rounded-lg border border-line bg-surface-2/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-accent-300">
          {TOOL_LABELS[action.tool]}
        </span>
        {action.confidence === "unknown" ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
            unverified — treat as hypothesis
          </span>
        ) : (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
            grounded
          </span>
        )}
        {destructive && (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-300">
            destructive
          </span>
        )}
      </div>

      <ActionBody action={action} ctx={ctx} />

      <p className="mt-2 text-xs text-neutral-400">
        <span className="text-neutral-500">Why: </span>
        {action.rationale}
      </p>
      {(action.evidence.length > 0 || action.droppedEvidence > 0) && (
        <p className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
          {action.evidence.map((e, i) => (
            <span key={i} className="rounded bg-surface px-1.5 py-0.5 text-neutral-400">
              {e.type}:{e.id}
            </span>
          ))}
          {action.droppedEvidence > 0 && (
            <span className="text-amber-400/80">
              +{action.droppedEvidence} cited ref(s) didn&apos;t check out
            </span>
          )}
        </p>
      )}
      {action.validationExperiment && (
        <p className="mt-1 text-xs text-neutral-500">
          To verify: try “{action.validationExperiment.angle}” on{" "}
          {action.validationExperiment.community || action.validationExperiment.platformId}.
        </p>
      )}
      <p className="mt-1.5 text-[11px] text-neutral-500">
        <span className="text-neutral-600">If applied: </span>
        {impactOf(action, ctx)}
      </p>

      <div className="mt-2.5 flex gap-2">
        {decision ? (
          <span
            className={`text-xs font-medium ${
              decision === "applied" ? "text-emerald-400" : "text-neutral-500"
            }`}
          >
            {decision === "applied" ? "✓ Applied" : "Dismissed"}
          </span>
        ) : action.tool === "ask_clarifying_question" ? (
          <div className="flex flex-wrap gap-1.5">
            {(action.options ?? []).map((o) => (
              <Button
                key={o}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onAnswer(o)}
              >
                {o}
              </Button>
            ))}
          </div>
        ) : informational ? (
          <span className="text-[11px] text-neutral-600">No change to apply.</span>
        ) : (
          <>
            <Button
              size="sm"
              disabled={busy}
              className={armed ? "bg-red-700 hover:bg-red-600" : ""}
              onClick={() => {
                if (destructive && !armed) return setArmed(true);
                onApply();
              }}
            >
              {destructive && armed
                ? "Confirm — yes, do it"
                : destructive
                  ? "Apply…"
                  : "Apply"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onReject}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Tool-specific body: diffs for updates, content preview for variants. */
function ActionBody({ action, ctx }: { action: ProposedAction; ctx: ActionContext }) {
  switch (action.tool) {
    case "update_positioning":
      return (
        <div className="mt-2 space-y-1.5 text-xs">
          {action.positioning && (
            <Diff
              label="Positioning"
              from={ctx.strategy?.positioning ?? ""}
              to={action.positioning}
            />
          )}
          {action.antiPositioning && (
            <Diff
              label="Anti-positioning"
              from={ctx.strategy?.antiPositioning ?? ""}
              to={action.antiPositioning}
            />
          )}
        </div>
      );
    case "update_channel_priority": {
      const rec = ctx.strategy?.recommendations.find(
        (r) => r.platformId === action.platformId
      );
      return (
        <p className="mt-2 text-sm text-neutral-200">
          {rec?.platformName ?? action.platformId}:{" "}
          <span className="text-neutral-500 line-through">{rec?.priority}</span> →{" "}
          <span className="font-medium">{action.priority}</span>
        </p>
      );
    }
    case "generate_variant":
      return action.hook && action.body ? (
        <div className="mt-2 rounded-md bg-surface p-2.5">
          <div className="text-xs font-semibold text-accent-300">{action.hook}</div>
          <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-neutral-300">
            {action.body}
          </pre>
        </div>
      ) : (
        <p className="mt-2 text-sm text-neutral-200">
          Direction: {action.direction || "same message, better execution"}
        </p>
      );
    case "create_experiment":
      return (
        <p className="mt-2 text-sm text-neutral-200">
          {action.platformId}
          {action.community ? ` · ${action.community}` : ""} — “{action.angle}”
          <span className="mt-1 block text-xs text-neutral-500">{action.hypothesis}</span>
        </p>
      );
    case "propose_next_actions":
      return (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-neutral-200">
          {action.items.map((it, i) => (
            <li key={i}>
              {it.title}{" "}
              <span className="text-xs text-neutral-500">(~{it.estMinutes}m)</span>
            </li>
          ))}
        </ol>
      );
    case "ask_clarifying_question":
      return <p className="mt-2 text-sm text-neutral-200">{action.question}</p>;
    case "diagnose_outcome":
      return (
        <p className="mt-2 text-sm text-neutral-200">
          {action.diagnosis}
          {action.suggestion && (
            <span className="mt-1 block text-xs text-neutral-400">{action.suggestion}</span>
          )}
        </p>
      );
    case "record_outcome":
      return (
        <p className="mt-2 text-sm text-neutral-200">
          Open the {action.checkpoint} form — you type the numbers, never me.
        </p>
      );
    case "stop_or_continue_channel":
      return (
        <p className="mt-2 text-sm text-neutral-200">
          {action.decision === "stop" ? "Stop" : "Keep going on"} {action.platformId}.
        </p>
      );
  }
}

function Diff({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      {from && <p className="mt-0.5 text-neutral-500 line-through">{from}</p>}
      <p className="mt-0.5 text-neutral-100">{to}</p>
    </div>
  );
}

function MemoryView({
  memory,
  setTone,
  addBannedClaim,
  removeBannedClaim,
}: {
  memory: ProductMemory;
  setTone: (t?: string) => void;
  addBannedClaim: (c: string) => void;
  removeBannedClaim: (i: number) => void;
}) {
  const [tone, setToneDraft] = useState(memory.tone ?? "");
  const [claim, setClaim] = useState("");
  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
      <p className="text-xs text-neutral-500">
        What the copilot remembers between sessions. Lean by design — chat transcripts are
        never stored.
      </p>
      <label className="block text-xs text-neutral-400">
        Preferred tone
        <input
          value={tone}
          onChange={(e) => setToneDraft(e.target.value)}
          onBlur={() => setTone(tone.trim() || undefined)}
          placeholder="e.g. dry, technical, no exclamation marks"
          className="mt-1 block w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent-500"
        />
      </label>
      <div>
        <div className="text-xs text-neutral-400">Banned claims (never say)</div>
        <ul className="mt-1.5 space-y-1">
          {memory.bannedClaims.map((c, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1 text-xs"
            >
              <span className="min-w-0 flex-1">{c}</span>
              <button
                onClick={() => removeBannedClaim(i)}
                className="text-neutral-600 hover:text-red-400"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-1.5 flex gap-2">
          <input
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            placeholder='e.g. "AI-powered"'
            className="w-full rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-accent-500"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!claim.trim()}
            onClick={() => {
              addBannedClaim(claim);
              setClaim("");
            }}
          >
            Add
          </Button>
        </div>
      </div>
      {memory.angles.length > 0 && (
        <div>
          <div className="text-xs text-neutral-400">
            Learned angles (from recorded outcomes)
          </div>
          <ul className="mt-1.5 space-y-1 text-xs">
            {memory.angles.slice(-8).map((a, i) => (
              <li key={i} className="rounded-md bg-surface-2 px-2 py-1">
                <span
                  className={
                    a.verdict === "winning" ? "text-emerald-400" : "text-amber-400"
                  }
                >
                  {a.verdict}
                </span>{" "}
                on {a.platformId}: {a.angle}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AuditView({ workspace }: { workspace: WorkspaceState }) {
  const log = [...(workspace.auditLog ?? [])].reverse();
  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <p className="mb-3 text-xs text-neutral-500">
        Every copilot proposal and what happened to it. Blocked = the schema validator
        refused it before you ever saw it.
      </p>
      {log.length === 0 ? (
        <p className="text-xs text-neutral-600">Nothing yet.</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {log.map((e, i) => (
            <li key={i} className="rounded-md bg-surface-2 px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <span
                  className={
                    e.decision === "applied"
                      ? "text-emerald-400"
                      : e.decision === "blocked"
                        ? "text-red-400"
                        : "text-neutral-500"
                  }
                >
                  {e.decision}
                </span>
                {e.destructive && <span className="text-red-400/80">destructive</span>}
                <span className="ml-auto text-neutral-600">
                  {new Date(e.at).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="mt-0.5 text-neutral-300">{e.summary}</div>
              <div className="text-[10px] text-neutral-600">
                evidence {e.evidenceVerified}/{e.evidenceCited} verified
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
