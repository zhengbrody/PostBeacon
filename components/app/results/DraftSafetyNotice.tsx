import type { DraftSafetyReport } from "@/lib/contentSafety";

export function DraftSafetyNotice({ report }: { report: DraftSafetyReport }) {
  if (report.ready) {
    return (
      <div
        className="rounded-lg border border-emerald-900/70 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300"
        role="status"
      >
        ✓ Truth check passed — no high-confidence unsupported claims detected.
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-amber-800/70 bg-amber-950/25 px-3 py-2.5 text-xs"
      role="alert"
    >
      <div className="font-semibold text-amber-200">
        Fix {report.issues.length} truth {report.issues.length === 1 ? "issue" : "issues"}{" "}
        before copying or tracking this draft
      </div>
      <ul className="mt-2 space-y-2">
        {report.issues.map((item) => (
          <li key={item.code}>
            <div className="text-amber-100">{item.title}</div>
            <div className="mt-0.5 text-amber-300/70">“{item.excerpt}”</div>
            <div className="mt-0.5 text-neutral-400">{item.fix}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
