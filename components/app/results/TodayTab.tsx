"use client";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { TodayAction, TodayView } from "@/lib/today";

/**
 * Today — the workspace's default surface. At most 3 derived action cards;
 * everything else stays behind the secondary nav (progressive disclosure).
 */
export function TodayTab({
  view,
  loading,
  onPublish,
  onRecord,
  onSkip,
  onDoneCustom,
  onOpenContent,
  onOpenReview,
}: {
  view: TodayView;
  loading: boolean;
  onPublish: (platformId: string) => void;
  onRecord: (action: TodayAction) => void;
  onSkip: (action: TodayAction) => void;
  onDoneCustom: (action: TodayAction) => void;
  onOpenContent: (platformId?: string) => void;
  onOpenReview: () => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Today</h2>
        {view.weeklyMinutes ? (
          <span className="text-xs text-neutral-500">
            ~{view.plannedMinutes} min shown · budget {view.weeklyMinutes} min/week
          </span>
        ) : (
          <span className="text-xs text-neutral-600">
            ~{view.plannedMinutes} min of focused work
          </span>
        )}
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Launch momentum
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

      {view.actions.map((a) => (
        <Card key={a.id} className={`p-5 ${a.due ? "" : "border-dashed opacity-80"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-neutral-100">{a.title}</h3>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-neutral-400">
                  ~{a.estMinutes} min
                </span>
                {!a.due && (
                  <span className="text-[11px] uppercase tracking-wide text-neutral-500">
                    up next
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">{a.whyNow}</p>
              {a.kind === "post" && a.platformId && (
                <button
                  className="mt-2 text-xs font-medium text-accent-300 hover:underline"
                  onClick={() => onOpenContent(a.platformId)}
                >
                  View the drafts you&apos;ll use →
                </button>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              {a.kind === "record" && (
                <Button size="sm" disabled={loading} onClick={() => onRecord(a)}>
                  Record results
                </Button>
              )}
              {a.kind === "post" && a.platformId && (
                <Button
                  size="sm"
                  disabled={loading}
                  onClick={() => onPublish(a.platformId!)}
                >
                  I published it
                </Button>
              )}
              {a.kind === "custom" && (
                <Button size="sm" disabled={loading} onClick={() => onDoneCustom(a)}>
                  Done
                </Button>
              )}
              {a.kind === "review" && (
                <Button size="sm" onClick={onOpenReview}>
                  Open review
                </Button>
              )}
              {a.kind !== "review" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loading}
                  onClick={() => onSkip(a)}
                >
                  Skip
                </Button>
              )}
            </div>
          </div>
        </Card>
      ))}
    </section>
  );
}
