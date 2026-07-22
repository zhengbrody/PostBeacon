"use client";

import { Card } from "@/components/ui/Card";
import { PRIMARY_GOALS, recommendedPrimaryGoal } from "@/lib/growth";

/**
 * Growth-workspace intake. The primary goal is required; launch date and
 * weekly time budget remain optional and degrade to relative days/no meter.
 */

const BUDGETS: { label: string; minutes: number }[] = [
  { label: "2 h/week", minutes: 120 },
  { label: "5 h/week", minutes: 300 },
  { label: "10 h/week", minutes: 600 },
  { label: "20 h/week", minutes: 1200 },
];

export function LaunchSetup({
  launchDate,
  setLaunchDate,
  weeklyMinutes,
  setWeeklyMinutes,
  primaryGoal,
  stage,
  setPrimaryGoal,
  publisherVoice,
  setPublisherVoice,
}: {
  launchDate: string;
  setLaunchDate: (v: string) => void;
  weeklyMinutes?: number;
  setWeeklyMinutes: (m?: number) => void;
  primaryGoal?: string;
  stage?: string;
  setPrimaryGoal: (goal: string) => void;
  publisherVoice?: "brand" | "founder";
  setPublisherVoice: (voice: "brand" | "founder") => void;
}) {
  const recommended = recommendedPrimaryGoal(stage);
  const customGoal =
    primaryGoal && !(PRIMARY_GOALS as readonly string[]).includes(primaryGoal);

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Choose what success means first</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Every channel and experiment will be judged against this one outcome.
          </p>
        </div>
        {primaryGoal && (
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
            Goal selected
          </span>
        )}
      </div>
      <div className="mt-4 rounded-lg border border-accent-700/40 bg-accent-600/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-accent-300">
              Primary growth goal · required
            </h3>
            <p className="mt-1 text-xs text-neutral-400">
              {primaryGoal
                ? `Selected: ${primaryGoal}`
                : "Choose a goal below or use the recommendation. You can change it later."}
            </p>
          </div>
          {!primaryGoal && (
            <button
              type="button"
              className="min-h-11 rounded-lg border border-accent-500/60 bg-accent-600/20 px-3 py-2 text-left text-xs font-medium text-accent-200 hover:bg-accent-600/30"
              onClick={() => setPrimaryGoal(recommended)}
            >
              Use recommended: {recommended}
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {PRIMARY_GOALS.map((goal) => (
            <button
              type="button"
              key={goal}
              onClick={() => setPrimaryGoal(goal)}
              className={`min-h-11 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                primaryGoal === goal
                  ? "border-accent-500 bg-accent-600/25 text-accent-100"
                  : "border-line bg-surface-2 text-neutral-300 hover:border-neutral-600"
              }`}
            >
              {goal}
            </button>
          ))}
          {customGoal && (
            <span className="rounded-full border border-accent-500 bg-accent-600/25 px-2.5 py-1 text-xs text-accent-100">
              {primaryGoal}
            </span>
          )}
        </div>
      </div>

      <details className="mt-4 rounded-lg border border-line bg-surface-2/50">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-white/[0.02]">
          <span>
            <span className="block text-sm font-medium text-neutral-200">
              Plan preferences
            </span>
            <span className="mt-0.5 block text-xs text-neutral-500">
              Optional · relative dates and safe brand voice work by default
            </span>
          </span>
          <span className="text-xs font-medium text-accent-300">Customize ↓</span>
        </summary>

        <div className="border-t border-line p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs text-neutral-400">
              When do you want to launch?
              <input
                type="date"
                value={launchDate}
                onChange={(e) => setLaunchDate(e.target.value)}
                className="mt-1.5 block w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent-500"
              />
              <span className="mt-1 block text-[11px] text-neutral-600">
                Day 1 of the calendar. Leave empty to plan in relative days.
              </span>
            </label>
            <div className="text-xs text-neutral-400">
              How much time can you give this weekly?
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {BUDGETS.map((b) => (
                  <button
                    key={b.minutes}
                    onClick={() =>
                      setWeeklyMinutes(weeklyMinutes === b.minutes ? undefined : b.minutes)
                    }
                    className={`min-h-11 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      weeklyMinutes === b.minutes
                        ? "border-accent-500 bg-accent-600/20 text-accent-200"
                        : "border-line bg-surface-2 text-neutral-300 hover:border-neutral-600"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
              <span className="mt-1 block text-[11px] text-neutral-600">
                Today&apos;s action list budgets itself against this.
              </span>
            </div>
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Publishing voice
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              This controls who the drafts are allowed to speak as. It never invents a
              biography to make a post sound personal.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    id: "brand",
                    label: "Brand voice · safe default",
                    detail: "Product/team language. No personal stories or credentials.",
                  },
                  {
                    id: "founder",
                    label: "Founder voice",
                    detail: "First person is allowed, but only with confirmed facts.",
                  },
                ] as const
              ).map((voice) => {
                const selected = (publisherVoice ?? "brand") === voice.id;
                return (
                  <button
                    type="button"
                    key={voice.id}
                    onClick={() => setPublisherVoice(voice.id)}
                    className={`min-h-20 rounded-lg border p-3 text-left transition-colors ${
                      selected
                        ? "border-accent-500 bg-accent-600/15"
                        : "border-line bg-surface-2 hover:border-neutral-600"
                    }`}
                  >
                    <span className="block text-sm font-medium text-neutral-100">
                      {voice.label}
                    </span>
                    <span className="mt-1 block text-xs text-neutral-500">
                      {voice.detail}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </details>
    </Card>
  );
}
