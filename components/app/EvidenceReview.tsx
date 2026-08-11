import { Card } from "@/components/ui/Card";
import type { Fact } from "@/lib/types";

/** One disclosure owns the detailed proof surface so Diagnose remains fast
 * without weakening the Fact Ledger or hiding unresolved evidence. */
export function EvidenceReview({
  facts,
  children,
}: {
  facts: Fact[];
  children: React.ReactNode;
}) {
  const needsReview = facts.filter(
    (fact) => fact.status === "inferred" || fact.status === "unknown"
  ).length;
  const verified = facts.filter(
    (fact) => fact.status === "observed" || fact.status === "user-confirmed"
  ).length;

  return (
    <Card className="overflow-hidden">
      <details>
        <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 hover:bg-white/[0.02]">
          <span>
            <span className="block text-sm font-semibold text-neutral-100">
              Review all evidence
            </span>
            <span className="mt-0.5 block text-xs text-neutral-500">
              {verified} verified · {needsReview} need review · sources and exact quotes
            </span>
          </span>
          <span className="shrink-0 text-xs font-medium text-accent-300">
            Open review ↓
          </span>
        </summary>
        <div className="space-y-5 border-t border-line p-5">{children}</div>
      </details>
    </Card>
  );
}
