"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type {
  AgentAction,
  AgentPlan,
  AgentStep,
  AgentStepStatus,
  AgentView,
} from "@/lib/agentPlan";

const STATUS: Record<AgentStepStatus, { label: string; tone: string; mark: string }> = {
  done: { label: "Done", tone: "border-emerald-700/60 text-emerald-300", mark: "✓" },
  running: { label: "Working", tone: "border-accent-600 text-accent-200", mark: "…" },
  ready: { label: "Ready", tone: "border-accent-700/60 text-accent-300", mark: "→" },
  "needs-you": {
    label: "Needs you",
    tone: "border-amber-700/60 text-amber-300",
    mark: "!",
  },
  waiting: { label: "Waiting", tone: "border-line text-neutral-500", mark: "·" },
};

function StepRow({
  step,
  current,
  view,
  onOpen,
}: {
  step: AgentStep;
  current: boolean;
  view: AgentView;
  onOpen: (view: AgentView) => void;
}) {
  const status = STATUS[step.status];
  const canOpen = step.view && step.view !== view && step.status !== "waiting";
  return (
    <li
      aria-current={current ? "step" : undefined}
      className={`rounded-lg border px-3 py-2.5 ${
        current ? "border-accent-700/60 bg-accent-950/20" : "border-line/60"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${status.tone}`}
        >
          <span aria-hidden>{status.mark} </span>
          {status.label}
        </span>
        <span className="min-w-0 flex-1 text-sm font-medium text-neutral-100">
          {step.title}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-neutral-500">
          {step.owner === "agent" ? "Agent" : "You"}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-neutral-400">{step.detail}</p>
      {canOpen && (
        <button
          type="button"
          className="mt-1.5 text-xs font-medium text-accent-300 hover:text-accent-200"
          onClick={() => onOpen(step.view!)}
        >
          Open this step
        </button>
      )}
    </li>
  );
}

/**
 * One place to see what the agent has done, what it will do next and where it
 * stops for the founder. It adds no state and no model route: every status is
 * derived by `deriveAgentPlan`, and the single button runs an existing step.
 */
export function AgentPlanCard({
  plan,
  view,
  loading,
  demo,
  onRun,
  onOpen,
}: {
  plan: AgentPlan;
  view: AgentView;
  loading: boolean;
  demo: boolean;
  onRun: (action: AgentAction) => void;
  onOpen: (view: AgentView) => void;
}) {
  const current = plan.current;
  const requests = plan.remainingModelRequests;
  return (
    <Card className="no-print mb-6 p-4 sm:p-5">
      <details open={view === "input" || undefined}>
        <summary className="cursor-pointer list-none">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-300">
                Marketing agent
              </p>
              <h2 className="mt-0.5 text-sm font-semibold text-neutral-100">
                {current
                  ? `Next: ${current.title.toLowerCase()}`
                  : "This experiment is recorded"}
              </h2>
            </div>
            <span className="text-xs text-neutral-400">
              {plan.doneCount} of {plan.steps.length} steps done · plan
            </span>
          </div>
        </summary>
        <ol className="mt-4 space-y-2" aria-label="Agent plan">
          {plan.steps.map((step) => (
            <StepRow
              key={step.id}
              step={step}
              current={step.id === current?.id}
              view={view}
              onOpen={onOpen}
            />
          ))}
        </ol>
        <p className="mt-3 text-xs leading-relaxed text-neutral-500">
          {demo
            ? "Fictional example: no step here calls a model."
            : requests > 0
              ? `The remaining agent steps use about ${requests} model request${requests === 1 ? "" : "s"} from your daily allowance.`
              : "No agent step is left that calls a model."}{" "}
          The agent prepares and never posts. Every step marked You waits for you.
        </p>
      </details>
      {current?.action && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={loading} onClick={() => onRun(current.action!)}>
            {current.actionLabel}
          </Button>
          {!demo && (
            <span className="text-xs text-neutral-500">
              Uses about {current.modelRequests} model request
              {current.modelRequests === 1 ? "" : "s"}.
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
