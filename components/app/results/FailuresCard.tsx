import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { GenerationFailure } from "@/lib/types";

/** Partial success (M13): failed channels are listed, not lost — the rest of
 *  the plan stands, each failure retries alone. */
export function FailuresCard({
  failures,
  loading,
  onRetry,
}: {
  failures: GenerationFailure[];
  loading: boolean;
  onRetry: (platformId: string) => void;
}) {
  return (
    <Card className="no-print border-amber-700/50 bg-amber-500/10 p-4">
      <h2 className="text-sm font-semibold text-amber-300">
        {failures.length} {failures.length === 1 ? "channel" : "channels"} didn&apos;t
        generate
      </h2>
      <p className="mt-0.5 text-xs text-neutral-400">
        Everything else succeeded. Retry these individually — no other content is lost.
      </p>
      <ul className="mt-2 space-y-1.5">
        {failures.map((f) => (
          <li
            key={f.platformId}
            className="flex flex-wrap items-center gap-2 text-sm text-neutral-200"
          >
            <span className="font-medium">{f.platformName}</span>
            <span className="text-xs text-neutral-500">{f.error}</span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={loading}
              onClick={() => onRetry(f.platformId)}
            >
              ↻ Retry
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
