import { FEEDBACK_URL } from "@/lib/site";

/**
 * A quiet beta feedback ask, shown once the user has a plan in front of them —
 * the moment they have an opinion worth capturing. Links out (GitHub issues by
 * default), so there's no backend to run during beta.
 */
export function FeedbackCTA() {
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/60 px-5 py-4 text-sm">
      <div>
        <span className="font-medium text-neutral-100">PostBeacon is in beta.</span>{" "}
        <span className="text-neutral-400">
          What&apos;s sharp, what&apos;s off, what&apos;s missing? Tell us — it shapes what
          ships next.
        </span>
      </div>
      <a
        href={FEEDBACK_URL}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 rounded-lg border border-line px-4 py-2 text-neutral-200 transition-colors hover:border-accent-500"
      >
        Send feedback →
      </a>
    </div>
  );
}
