import type { ExecutionStep } from "@/lib/execution";

export function ExecutionProgress({ steps }: { steps: ExecutionStep[] }) {
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="Experiment progress">
      {steps.map((step) => (
        <li key={step.id} aria-current={step.active ? "step" : undefined}>
          <div
            className={`h-1.5 rounded-full transition-colors ${
              step.done ? "bg-emerald-500" : step.active ? "bg-accent-400" : "bg-surface-2"
            }`}
          />
          <div
            className={`mt-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide ${
              step.done
                ? "text-emerald-300"
                : step.active
                  ? "text-accent-300"
                  : "text-neutral-600"
            }`}
          >
            {step.done && <span aria-hidden>✓</span>}
            {step.label}
          </div>
        </li>
      ))}
    </ol>
  );
}
