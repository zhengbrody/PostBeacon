import type { Priority } from "@/lib/types";

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
