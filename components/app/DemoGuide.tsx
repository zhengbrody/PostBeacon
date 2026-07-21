"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export type DemoGuideStep = "prepare" | "publish" | "measure" | "learn";

const STEPS: Array<{
  id: DemoGuideStep;
  label: string;
  title: string;
  body: string;
  action: string;
}> = [
  {
    id: "prepare",
    label: "Prepare",
    title: "Start with one evidence-backed move",
    body: "See why this channel was chosen, which verified facts support the draft, and what signal the experiment is meant to test.",
    action: "Show me the draft",
  },
  {
    id: "publish",
    label: "Publish",
    title: "Review before anything goes live",
    body: "Try a hook, edit the copy, and confirm a manual publish. PostBeacon never posts or claims success on your behalf.",
    action: "Try the publish step",
  },
  {
    id: "measure",
    label: "Measure",
    title: "Record an honest result",
    body: "Add the example 24h signal. Missing metrics stay empty, and a real zero remains a valid result.",
    action: "Record the example result",
  },
  {
    id: "learn",
    label: "Learn",
    title: "See what changes next",
    body: "Read the explainable verdict, see the learning added to the project, and open the next recommended experiment.",
    action: "Show the next experiment",
  },
];

export interface DemoGuideProps {
  /** Projected from the existing demo/workspace state; this component stores nothing. */
  currentStep: DemoGuideStep;
  /** Runs the real demo action or navigation for the current workspace step. */
  onPrimaryAction: (step: DemoGuideStep) => void;
  onSkip: () => void;
  onClose: () => void;
  busy?: boolean;
}

/**
 * A controlled walkthrough for the example project. The parent owns all ephemeral
 * navigation and durable workspace state, so the guide can never drift from the
 * actual Prepare → Publish → Measure → Learn lifecycle.
 */
export function DemoGuide({
  currentStep,
  onPrimaryAction,
  onSkip,
  onClose,
  busy = false,
}: DemoGuideProps) {
  const activeIndex = STEPS.findIndex((step) => step.id === currentStep);
  const active = STEPS[activeIndex] ?? STEPS[0];

  return (
    <Card
      className="no-print overflow-hidden border-accent-500/40 bg-accent-600/5"
      role="region"
      aria-label="Three-minute example walkthrough"
    >
      <div className="border-b border-line/80 px-4 py-3 sm:px-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-300">
              3-minute walkthrough
            </p>
            <p className="mt-1 text-xs text-neutral-400">
              Example data — never saved. Try the full loop without publishing anything.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 -mt-1 flex min-h-11 min-w-11 items-center justify-center rounded-lg text-lg text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-200"
            aria-label="Close example walkthrough"
          >
            ×
          </button>
        </div>

        <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Walkthrough progress">
          {STEPS.map((step, index) => {
            const complete = index < activeIndex;
            const current = index === activeIndex;
            return (
              <li key={step.id} aria-current={current ? "step" : undefined}>
                <span
                  className={`block h-1.5 rounded-full transition-colors ${
                    complete ? "bg-emerald-500" : current ? "bg-accent-400" : "bg-surface-2"
                  }`}
                />
                <span
                  className={`mt-1.5 block truncate text-[10px] font-medium sm:text-xs ${
                    current
                      ? "text-accent-300"
                      : complete
                        ? "text-emerald-300"
                        : "text-neutral-600"
                  }`}
                >
                  {complete ? "✓ " : ""}
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="px-4 py-5 sm:px-5" aria-live="polite">
        <p className="text-xs font-medium text-neutral-500">
          Step {activeIndex + 1} of {STEPS.length}
        </p>
        <h2 className="mt-1.5 text-lg font-semibold text-neutral-100">{active.title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-400">
          {active.body}
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            type="button"
            onClick={() => onPrimaryAction(active.id)}
            disabled={busy}
            className="min-h-11 sm:min-w-52"
          >
            {busy ? "Updating example…" : `${active.action} →`}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onSkip}
            disabled={busy}
            className="min-h-11"
          >
            Skip walkthrough
          </Button>
        </div>
      </div>
    </Card>
  );
}
