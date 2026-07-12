"use client";

import { Card } from "@/components/ui/Card";

/**
 * Launch setup (M15 intake): the two workspace facts a landing page never
 * states — launch date and weekly time budget. Lives on the Diagnose step
 * next to the clarifying questions; both are skippable (Today degrades to
 * relative days / no budget meter).
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
}: {
  launchDate: string;
  setLaunchDate: (v: string) => void;
  weeklyMinutes?: number;
  setWeeklyMinutes: (m?: number) => void;
}) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Launch setup</h2>
      <p className="mb-4 mt-1 text-xs text-neutral-500">
        Two things your page can&apos;t tell us. They shape your day-by-day plan — skip
        either and the workspace still works, just less precisely.
      </p>
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
