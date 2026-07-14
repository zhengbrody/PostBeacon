import type { Step } from "@/hooks/useLaunchFlow";

const STEPS: { id: Step; label: string }[] = [
  { id: "input", label: "Analyze" },
  { id: "profile", label: "Diagnose" },
  { id: "strategy", label: "Strategy" },
  { id: "results", label: "Workspace" },
];

export function Stepper({
  step,
  enabled = [],
  onNavigate,
}: {
  step: Step;
  enabled?: Step[]; // steps the user has data for and may jump back to
  onNavigate?: (s: Step) => void;
}) {
  const idx = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="mb-8 flex flex-wrap items-center gap-2 text-xs">
      {STEPS.map((s, i) => {
        const canGo = !!onNavigate && s.id !== step && enabled.includes(s.id);
        const done = i <= idx;
        return (
          <li key={s.id} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canGo}
              onClick={() => canGo && onNavigate!(s.id)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors ${
                done ? "bg-accent-600 text-white" : "bg-surface-2 text-neutral-400"
              } ${canGo ? "cursor-pointer hover:bg-accent-500" : "cursor-default"}`}
            >
              <span className="font-mono">{i + 1}</span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && <span className="text-neutral-700">→</span>}
          </li>
        );
      })}
    </ol>
  );
}
