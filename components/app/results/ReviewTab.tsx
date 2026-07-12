import { Card } from "@/components/ui/Card";
import { weeklyReview } from "@/lib/today";
import { clipString } from "@/lib/coerce";
import type { MarketingStrategy, WorkspaceState } from "@/lib/types";

/**
 * Weekly Review. The headline number is the north star: completed learning
 * loops (published → outcomes recorded → verdict) in the last 7 days — not
 * how much content was generated.
 */
export function ReviewTab({
  workspace,
  strategy,
  now = new Date(),
}: {
  workspace: WorkspaceState;
  strategy: MarketingStrategy | null;
  now?: Date;
}) {
  const review = weeklyReview({ workspace, strategy }, now);

  return (
    <section className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Learning loops closed · last 7 days
            </h2>
            <p className="mt-1 text-5xl font-bold text-accent-300">
              {review.loopsThisWeek}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              A loop = you published, recorded the results, and got a verdict. This is the
              number that compounds — not posts drafted.
            </p>
          </div>
          {review.bestAngle && (
            <div className="max-w-xs text-right">
              <div className="text-xs uppercase tracking-wide text-neutral-500">
                Best angle so far
              </div>
              <div className="mt-1 text-sm text-neutral-200">
                “{clipString(review.bestAngle, 90)}”
              </div>
            </div>
          )}
        </div>
      </Card>

      {review.channels.length > 0 && (
        <Card className="p-6">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Channel scoreboard
          </h3>
          <div className="space-y-1.5 text-sm">
            {review.channels.map((c) => (
              <div
                key={c.platformId}
                className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 px-3 py-2"
              >
                <span className="min-w-0 flex-1 font-medium text-neutral-100">
                  {c.platformName}
                </span>
                <span className="text-xs text-neutral-500">
                  {c.experiments} experiment{c.experiments === 1 ? "" : "s"} · {c.outcomes}{" "}
                  check-in{c.outcomes === 1 ? "" : "s"}
                </span>
                {c.bestCall && (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-neutral-300">
                    best: {c.bestCall}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-6">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Next week
        </h3>
        <ul className="space-y-1.5 text-sm text-neutral-300">
          {review.suggestions.map((s, i) => (
            <li key={i}>· {s}</li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
