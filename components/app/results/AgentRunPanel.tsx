"use client";

import { Button } from "@/components/ui/Button";
import { AGENT_PHASES, agentRunMessage, agentRunLabel } from "@/lib/agentRuns";
import type { GrowthAgentControls } from "@/hooks/useGrowthAgent";

const labels = {
  queued: "Task saved",
  sources: "Sources",
  model: "One model request",
  ready: "Your review",
};
export function AgentRunPanel({
  agent,
  onReview,
}: {
  agent: GrowthAgentControls;
  onReview: (id: string) => void;
}) {
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-400">
          Agent inbox · latest 5 tasks · refresh restores server receipts
        </p>
        <Button variant="ghost" onClick={agent.refresh} disabled={agent.busy}>
          Refresh tasks
        </Button>
      </div>
      <p className="text-xs text-neutral-400">
        Results are saved here while you are away and refreshed when you return to this
        page. This is in-app delivery, not email, device push or social publication.
      </p>
      {agent.runs.length > 0 && (
        <p role="status" aria-live="polite" className="text-sm text-accent-200">
          {
            agent.runs.filter(
              (run) => run.status === "ready" && Boolean(run.research?.opportunities.length)
            ).length
          }{" "}
          tasks with draft proposals ·{" "}
          {
            agent.runs.filter(
              (run) => run.status === "ready" && !run.research?.opportunities.length
            ).length
          }{" "}
          finished without a draft
        </p>
      )}
      {agent.error && (
        <p role="alert" className="text-sm text-amber-300">
          {agent.error}
        </p>
      )}
      {agent.checking && (
        <p role="status" className="text-sm text-neutral-400">
          Checking persistent task availability…
        </p>
      )}
      {!agent.checking && !agent.enabled && !agent.error && (
        <p role="status" className="text-sm text-neutral-400">
          Persistent Agent tasks are not enabled on this deployment yet. No model will be
          called. Existing plans remain usable.
        </p>
      )}
      {agent.enabled && !agent.runs.length && (
        <p className="text-sm text-neutral-400">
          No research task yet. Prepare one below; nothing runs until you start it.
        </p>
      )}
      {agent.runs.map((run) => (
        <article key={run.id} className="rounded-xl border border-line bg-surface-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="min-w-0 break-words font-medium">{run.input.task}</h4>
            <span className="text-xs text-accent-300">
              {agentRunLabel(run)} ·{" "}
              {run.modelAttempted ? run.provider : "model not called"}
            </span>
          </div>
          <ol
            aria-label="Recorded Agent steps"
            className="my-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"
          >
            {AGENT_PHASES.map((phase, index) => (
              <li
                key={phase}
                aria-current={run.phase === phase ? "step" : undefined}
                className={`rounded-lg border p-2 ${run.phase === phase ? "border-accent-500 text-accent-300" : "border-line text-neutral-400"}`}
              >
                {index + 1}.{" "}
                {phase === "sources" && run.autonomous
                  ? "Approved public research"
                  : phase === "sources" && run.input.mode === "product-led"
                    ? "Input checks / product facts"
                    : phase === "ready" && run.autonomous && !run.research
                      ? "Result receipt"
                      : labels[phase]}
                {phase === "model" && run.status === "ready" && !run.modelAttempted
                  ? " · not needed"
                  : AGENT_PHASES.indexOf(run.phase) > index
                    ? " · recorded"
                    : ""}
              </li>
            ))}
          </ol>
          <p role="status" className="text-sm text-neutral-300">
            {agentRunMessage(run)}
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Last server receipt: {run.updatedAt} ·{" "}
            {run.autonomous
              ? `${run.checkedSources} source-check receipts; search matches are not verified demand`
              : run.input.mode === "product-led"
                ? "Product-facts mode; no external demand sources"
                : `${run.checkedSources}/${run.sourceCount} source receipts`}{" "}
            ·{" "}
            {run.modelAttempted
              ? "1 request reserved (not proof of provider completion)"
              : "No model request reserved"}
          </p>
          {run.autonomous ? (
            <div className="mt-2 text-xs text-neutral-400">
              <p>
                Daily authorization revision {run.missionRevision ?? "unknown"} ·{" "}
                {run.searchAttempted
                  ? "Search attempt reserved; not proof of delivery"
                  : "No search attempt reserved"}
              </p>
              {run.searchReceipt ? (
                <p className="mt-1">
                  Search receipt: {run.searchReceipt.status} ·{" "}
                  {run.searchReceipt.resultCount} results ·{" "}
                  {run.searchReceipt.candidateCount} eligible candidates. Empty results do
                  not prove a lack of demand; posting permission remains unreviewed.
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {run.status === "ready" && run.research && (
              <Button onClick={() => onReview(run.id)}>
                {run.research.opportunities.length
                  ? "Review draft proposals →"
                  : "Review source checks →"}
              </Button>
            )}
            {run.canResume && (
              <Button
                variant="ghost"
                disabled={agent.busy}
                onClick={() => void agent.resume(run.id)}
              >
                {run.autonomous
                  ? "Resume approved public research"
                  : run.input.mode === "product-led"
                    ? "Resume input checks"
                    : "Resume source checks"}
              </Button>
            )}
            {(run.status === "queued" || run.status === "running") && (
              <Button
                variant="ghost"
                disabled={agent.busy}
                onClick={() => void agent.cancel(run.id)}
              >
                Cancel task
              </Button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
