import { Card } from "@/components/ui/Card";
import { timelineEvents } from "@/lib/today";
import type { WorkspaceState } from "@/lib/types";

/** Everything that happened, newest first — a projection, not new storage. */
export function TimelineTab({ workspace }: { workspace: WorkspaceState }) {
  const events = timelineEvents(workspace);
  if (events.length === 0) {
    return (
      <Card className="p-6 text-sm text-neutral-500">
        Nothing yet — publish your first planned post from Today and the timeline starts
        itself.
      </Card>
    );
  }
  return (
    <Card className="p-6">
      <h2 className="mb-4 text-lg font-semibold">Timeline</h2>
      <ol className="relative space-y-3 border-l border-line pl-5">
        {events.map((e, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[1.42rem] top-1.5 h-2 w-2 rounded-full bg-accent-500" />
            <div className="text-sm text-neutral-200">
              <span className="mr-1.5">{e.icon}</span>
              {e.text}
            </div>
            <div className="text-[11px] text-neutral-600">
              {new Date(e.at).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
