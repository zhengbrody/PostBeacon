import type { Step } from "@/hooks/useLaunchFlow";

const STEPS: { id: Step; label: string }[] = [
  { id: "input", label: "Analyze" },
  { id: "profile", label: "Diagnose" },
  { id: "strategy", label: "Strategy" },
  { id: "results", label: "Launch plan" },
];

export function Stepper({ step }: { step: Step }) {
  const idx = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="mb-8 flex flex-wrap items-center gap-2 text-xs">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 ${
              i <= idx
                ? "bg-accent-600 text-white"
                : "bg-surface-2 text-neutral-400"
            }`}
          >
            <span className="font-mono">{i + 1}</span>
            {s.label}
          </span>
          {i < STEPS.length - 1 && (
            <span className="text-neutral-700">→</span>
          )}
        </li>
      ))}
    </ol>
  );
}
