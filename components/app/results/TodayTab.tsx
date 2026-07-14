"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ExecutionProgress } from "./ExecutionProgress";
import { InlinePostWorkbench } from "./InlinePostWorkbench";
import { experimentLifecycle } from "@/lib/execution";
import type { TodayAction, TodayView } from "@/lib/today";
import type { Experiment, PlatformContent, PlatformPost } from "@/lib/types";

interface TodayActions {
  loading: boolean;
  onPublish: (platformId: string, postIdx?: number) => void;
  onRecord: (action: TodayAction) => void;
  onSkip: (action: TodayAction) => void;
  onDoneCustom: (action: TodayAction) => void;
  onOpenContent: (platformId?: string) => void;
  onOpenReview: () => void;
  onAskCopilot: (action: TodayAction, direction?: string) => void;
  onRegenerate: (platformId: string) => void;
  onUpdatePost: (platformId: string, idx: number, patch: Partial<PlatformPost>) => void;
}

function ActionButtons({
  action: a,
  primary,
  handlers,
}: {
  action: TodayAction;
  primary: boolean;
  handlers: TodayActions;
}) {
  const {
    loading,
    onPublish,
    onRecord,
    onSkip,
    onDoneCustom,
    onOpenContent,
    onOpenReview,
    onAskCopilot,
  } = handlers;

  return (
    <div className="flex flex-wrap gap-2">
      {a.kind === "record" && (
        <Button disabled={loading} onClick={() => onRecord(a)}>
          Record results
        </Button>
      )}
      {a.kind === "post" && a.platformId && (
        <>
          <Button disabled={loading} onClick={() => onPublish(a.platformId!)}>
            I published it
          </Button>
          <Button variant="outline" onClick={() => onOpenContent(a.platformId)}>
            Review draft
          </Button>
        </>
      )}
      {a.kind === "custom" && (
        <Button disabled={loading} onClick={() => onDoneCustom(a)}>
          Done
        </Button>
      )}
      {a.kind === "review" && <Button onClick={onOpenReview}>Open weekly review</Button>}
      {primary && (
        <Button variant="outline" disabled={loading} onClick={() => onAskCopilot(a)}>
          ✦ Ask Copilot
        </Button>
      )}
      {a.kind !== "review" && (
        <Button variant="ghost" disabled={loading} onClick={() => onSkip(a)}>
          Skip
        </Button>
      )}
    </div>
  );
}

function AlternativeMove({
  action,
  handlers,
}: {
  action: TodayAction;
  handlers: TodayActions;
}) {
  return (
    <div className="border-t border-line px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium text-neutral-200">{action.title}</h4>
            <span className="text-[11px] text-neutral-500">~{action.estMinutes} min</span>
            {!action.due && (
              <span className="text-[10px] uppercase tracking-wide text-neutral-600">
                up next
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">{action.whyNow}</p>
        </div>
        <ActionButtons action={action} primary={false} handlers={handlers} />
      </div>
    </div>
  );
}

function ActiveExperimentCard({
  experiment,
  onAsk,
  onRecordEarly,
  onOpenProgress,
}: {
  experiment: Experiment;
  onAsk: () => void;
  onRecordEarly: () => void;
  onOpenProgress: () => void;
}) {
  const lifecycle = experimentLifecycle(experiment, new Date());
  return (
    <Card className="border-emerald-900/70 bg-emerald-950/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
            Active experiment · {experiment.platformName}
          </div>
          <h3 className="mt-1 text-base font-semibold text-neutral-100">
            {lifecycle.headline}
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-neutral-400">
            {lifecycle.detail}
          </p>
        </div>
        {experiment.trackedUrl && (
          <a
            href={experiment.trackedUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-accent-300 hover:underline"
          >
            Open live post →
          </a>
        )}
      </div>
      <div className="mt-4">
        <ExecutionProgress steps={lifecycle.steps} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-500">
        <span>Angle: {experiment.angle || "Not recorded"}</span>
        <span>Published {new Date(experiment.publishedAt).toLocaleString()}</span>
        {experiment.community && <span>Venue: {experiment.community}</span>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {!lifecycle.complete && !lifecycle.due && (
          <Button size="sm" onClick={onRecordEarly}>
            Record an early result
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onAsk}>
          ✦ What should I measure?
        </Button>
        <Button size="sm" variant="ghost" onClick={onOpenProgress}>
          View experiment progress →
        </Button>
      </div>
    </Card>
  );
}

/**
 * M18 command center: one dominant next move. Existing M15 actions stay
 * available, but alternatives no longer compete above the fold.
 */
export function TodayTab({
  view,
  productName,
  primaryGoal,
  emailRemindersAvailable,
  emailRemindersEnabled,
  onToggleEmailReminders,
  primaryContent,
  posted,
  activeExperiment,
  primaryExperiment,
  notice,
  onDismissNotice,
  recordEditor,
  onAskExperiment,
  onRecordEarly,
  onOpenProgress,
  ...handlers
}: TodayActions & {
  view: TodayView;
  productName?: string;
  primaryGoal?: string;
  emailRemindersAvailable: boolean;
  emailRemindersEnabled: boolean;
  onToggleEmailReminders: (enabled: boolean) => void;
  primaryContent?: PlatformContent;
  posted: Record<string, boolean>;
  activeExperiment?: Experiment;
  primaryExperiment?: Experiment;
  notice?: { title: string; detail: string } | null;
  onDismissNotice: () => void;
  recordEditor?: ReactNode;
  onAskExperiment: (experiment: Experiment) => void;
  onRecordEarly: (experiment: Experiment) => void;
  onOpenProgress: () => void;
}) {
  const primary = view.primaryAction;
  const activeIsPrimaryRecord =
    primary.kind === "record" && primary.experimentId === activeExperiment?.id;

  return (
    <section className="space-y-4">
      {notice && (
        <div
          className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-emerald-800 bg-emerald-950/30 px-4 py-3"
          role="status"
        >
          <div>
            <div className="text-sm font-semibold text-emerald-200">✓ {notice.title}</div>
            <div className="mt-0.5 text-xs text-emerald-300/70">{notice.detail}</div>
          </div>
          <button
            type="button"
            onClick={onDismissNotice}
            className="text-xs text-emerald-300/60 hover:text-emerald-200"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-accent-700/60 bg-accent-600/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-300">
              {view.mode === "launch" ? "Launch mode" : "Growth mode"}
            </span>
            {productName && <span className="text-xs text-neutral-500">{productName}</span>}
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-100">
            {view.mode === "launch"
              ? "Get your first real signal"
              : "Keep the experiment moving"}
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            Primary goal:{" "}
            <span className="text-neutral-200">{primaryGoal || "Not set"}</span>
          </p>
        </div>
        <div className="text-right text-xs text-neutral-500">
          <div>{view.loopsThisWeek} completed experiments this week</div>
          <div className="mt-1">
            {view.plannedMinutes
              ? `~${view.plannedMinutes} min due now`
              : `No scheduled work due now`}
            {view.weeklyMinutes ? ` · ${view.weeklyMinutes} min/week budget` : ""}
          </div>
        </div>
      </div>

      {view.mode === "launch" && (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                First-value path
              </h3>
              <p className="mt-1 text-xs text-neutral-400">{view.activation.nextStep}</p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-accent-300">
              {view.activation.completed}/{view.activation.total}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {view.activation.milestones.map((milestone) => (
              <div key={milestone.id}>
                <div
                  className={`h-1.5 rounded-full ${
                    milestone.done ? "bg-accent-400" : "bg-surface-2"
                  }`}
                />
                <div
                  className={`mt-1 text-[10px] ${
                    milestone.done ? "text-neutral-300" : "text-neutral-600"
                  }`}
                >
                  {milestone.label}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeExperiment && !activeIsPrimaryRecord && !recordEditor && (
        <ActiveExperimentCard
          experiment={activeExperiment}
          onAsk={() => onAskExperiment(activeExperiment)}
          onRecordEarly={() => onRecordEarly(activeExperiment)}
          onOpenProgress={onOpenProgress}
        />
      )}

      <Card className="overflow-hidden border-accent-700/60 bg-gradient-to-br from-accent-950/50 to-surface/80">
        <div className="p-6 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-300">
              Next best move
            </h3>
            <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-neutral-400">
              ~{primary.estMinutes} min{primary.due ? " · due now" : " · up next"}
            </span>
          </div>
          <h4 className="mt-3 text-xl font-semibold text-neutral-50">
            {recordEditor ? "Record results and get the read" : primary.title}
          </h4>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-300">
            {recordEditor
              ? "Enter only what you actually observed. The verdict and next action update here immediately."
              : primary.whyNow}
          </p>
          {recordEditor ? (
            <div className="mt-5 border-t border-line pt-5">{recordEditor}</div>
          ) : primary.kind === "post" && primaryContent ? (
            <InlinePostWorkbench
              content={primaryContent}
              posted={posted}
              loading={handlers.loading}
              onUpdatePost={handlers.onUpdatePost}
              onRegenerate={handlers.onRegenerate}
              onPublish={(platformId, postIdx) => handlers.onPublish(platformId, postIdx)}
              onAskCopilot={(direction) => handlers.onAskCopilot(primary, direction)}
              onOpenLibrary={() => handlers.onOpenContent(primary.platformId)}
            />
          ) : (
            <div className="mt-5 space-y-4">
              {primary.kind === "record" && primaryExperiment && (
                <ExecutionProgress
                  steps={experimentLifecycle(primaryExperiment, new Date()).steps}
                />
              )}
              <ActionButtons action={primary} primary handlers={handlers} />
            </div>
          )}
        </div>
      </Card>

      {!recordEditor && view.alternatives.length > 0 && (
        <details className="group overflow-hidden rounded-xl border border-line bg-surface/40">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm text-neutral-400 transition-colors hover:text-neutral-200">
            <span className="inline-flex w-full items-center justify-between gap-3">
              Other valid moves ({view.alternatives.length})
              <span className="text-neutral-600 transition-transform group-open:rotate-180">
                ⌄
              </span>
            </span>
          </summary>
          {view.alternatives.map((action) => (
            <AlternativeMove key={action.id} action={action} handlers={handlers} />
          ))}
        </details>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line/70 px-3 py-2.5 text-xs text-neutral-500">
        <span>In-app reminders are on for 24h, 72h and weekly review events.</span>
        {emailRemindersAvailable ? (
          <label className="inline-flex cursor-pointer items-center gap-2 text-neutral-300">
            <input
              type="checkbox"
              checked={emailRemindersEnabled}
              onChange={(event) => onToggleEmailReminders(event.target.checked)}
              className="accent-accent-500"
            />
            Email me only when an action is due
          </label>
        ) : (
          <span className="text-neutral-600">Email delivery is not connected yet.</span>
        )}
      </div>
    </section>
  );
}
