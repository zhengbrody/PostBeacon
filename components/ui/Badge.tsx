import type { Confidence, Priority } from "@/lib/types";

const priorityStyles: Record<Priority, string> = {
  high: "bg-emerald-600/90 text-white",
  medium: "bg-amber-600/90 text-white",
  low: "bg-neutral-700 text-neutral-200",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${priorityStyles[priority]}`}
    >
      {priority}
    </span>
  );
}

const confidenceStyles: Record<Confidence, string> = {
  high: "border-emerald-700/60 text-emerald-300",
  medium: "border-amber-700/60 text-amber-300",
  low: "border-neutral-600 text-neutral-400",
};

/** A quieter, outlined tag for "how sure are we" signals. */
export function ConfidenceTag({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${confidenceStyles[confidence]}`}
    >
      {confidence} confidence
    </span>
  );
}
