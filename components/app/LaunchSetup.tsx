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
}: {
  launchDate: string;
  setLaunchDate: (v: string) => void;
  weeklyMinutes?: number;
  setWeeklyMinutes: (m?: number) => void;
  primaryGoal?: string;
  stage?: string;
  setPrimaryGoal: (goal: string) => void;
}) {
  const recommended = recommendedPrimaryGoal(stage);
  const customGoal =
    primaryGoal && !(PRIMARY_GOALS as readonly string[]).includes(primaryGoal);

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Launch setup</h2>
      <p className="mb-4 mt-1 text-xs text-neutral-500">
        Set the outcome that matters, then give the workspace enough context to budget the
        work around you.
      </p>
      <div className="mb-5 rounded-lg border border-accent-700/40 bg-accent-600/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-accent-300">
              Primary growth goal · required
            </h3>
            <p className="mt-1 text-xs text-neutral-400">
              PostBeacon uses one goal to judge every experiment. You can change it later.
            </p>
          </div>
          {!primaryGoal && (
            <button
              type="button"
              className="text-xs font-medium text-accent-300 hover:underline"
              onClick={() => setPrimaryGoal(recommended)}
            >
              Help me decide → {recommended}
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {PRIMARY_GOALS.map((goal) => (
            <button
              type="button"
              key={goal}
              onClick={() => setPrimaryGoal(goal)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
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
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
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
    </Card>
  );
}
