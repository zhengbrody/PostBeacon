"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PROVIDER_PRIVACY } from "@/lib/privacy";
import { isSafeExternalHref } from "@/lib/urlPolicy";
import type { AnalysisReceipt, EvidenceSourceInput, EvidenceSourceKind } from "@/lib/types";

const OPTIONAL_SOURCES: {
  kind: EvidenceSourceInput["kind"];
  label: string;
  placeholder: string;
}[] = [
  { kind: "pricing", label: "Pricing", placeholder: "https://product.com/pricing" },
  { kind: "docs", label: "Docs", placeholder: "https://docs.product.com" },
  {
    kind: "changelog",
    label: "Changelog",
    placeholder: "https://product.com/changelog",
  },
  { kind: "github", label: "GitHub", placeholder: "https://github.com/org/repo" },
];

const SOURCE_LABEL: Record<EvidenceSourceKind, string> = {
  primary: "Landing page",
  pricing: "Pricing",
  docs: "Docs",
  changelog: "Changelog",
  github: "GitHub",
  other: "Other",
};

function initialUrls(receipt: AnalysisReceipt): Record<string, string> {
  return Object.fromEntries(
    receipt.sources
      .filter((source) => source.kind !== "primary")
      .map((source) => [source.kind, source.requestedUrl])
  );
}

function failureLabel(failure?: AnalysisReceipt["sources"][number]["failure"]): string {
  if (failure === "invalid-url") return "Blocked before fetch: invalid or private URL";
  if (failure === "duplicate") return "Duplicate of another submitted source";
  return "Could not fetch this page";
}

export function SourceCoverageReceipt({
  receipt,
  loading,
  onReanalyze,
  example = false,
}: {
  receipt: AnalysisReceipt;
  loading: boolean;
  onReanalyze: (sources: EvidenceSourceInput[]) => void;
  example?: boolean;
}) {
  const [urls, setUrls] = useState<Record<string, string>>(() => initialUrls(receipt));
  useEffect(() => setUrls(initialUrls(receipt)), [receipt]);

  const sources = useMemo(
    () =>
      OPTIONAL_SOURCES.flatMap(({ kind }) => {
        const url = urls[kind]?.trim();
        return url ? [{ kind, url } satisfies EvidenceSourceInput] : [];
      }),
    [urls]
  );
  const provider = PROVIDER_PRIVACY[receipt.provider.provider].label;
  const addedCount = receipt.sources.filter((source) => source.kind !== "primary").length;

  return (
    <Card className="overflow-hidden border-emerald-900/60">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
              Analysis receipt
            </p>
            <h2 className="mt-1 text-lg font-semibold text-neutral-100">
              What PostBeacon actually checked
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              {example
                ? "Fictional walkthrough · no page fetch or model call"
                : `Completed ${new Date(receipt.completedAt).toLocaleString()} · ${provider}${receipt.provider.fallbackFrom ? ` after ${PROVIDER_PRIVACY[receipt.provider.fallbackFrom].label} failed` : ""}`}
            </p>
          </div>
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
            {example ? "Example data" : "Server verified"}
          </span>
        </div>

        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
          {[
            ["URLs validated", receipt.checks.urlsValidated],
            ["Pages fetched", receipt.checks.pagesFetched],
            ["Facts extracted", receipt.checks.factsExtracted],
            ["Claims verified", receipt.checks.claimsVerified],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-surface-2 px-3 py-2">
              <dt className="text-[11px] text-neutral-500">{label}</dt>
              <dd className="mt-0.5 font-semibold text-neutral-100">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <details className="border-t border-line">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 hover:bg-white/[0.02] sm:px-6">
          <span>
            <span className="block text-sm font-semibold text-neutral-100">
              {example ? "Review example sources" : "Review sources and add evidence"}
            </span>
            <span className="mt-0.5 block text-xs text-neutral-500">
              {receipt.sources.length} submitted · {addedCount} additional
            </span>
          </span>
          <span className="text-xs font-medium text-accent-300">Open details ↓</span>
        </summary>

        <div className="space-y-5 border-t border-line px-5 py-5 sm:px-6">
          <ul className="space-y-2">
            {receipt.sources.map((source, index) => (
              <li
                key={`${source.kind}-${source.requestedUrl}-${index}`}
                className="rounded-lg bg-surface-2 px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-neutral-200">
                    {SOURCE_LABEL[source.kind]}
                  </span>
                  <span
                    className={
                      source.status === "fetched" ? "text-emerald-300" : "text-amber-300"
                    }
                  >
                    {source.status === "fetched"
                      ? `${source.method === "rendered" ? "Rendered" : "Static"} fetch ✓`
                      : failureLabel(source.failure)}
                  </span>
                </div>
                {source.canonicalUrl && isSafeExternalHref(source.canonicalUrl) ? (
                  <a
                    href={source.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block break-all text-accent-300 hover:underline"
                  >
                    {source.canonicalUrl}
                  </a>
                ) : (
                  <p className="mt-1 break-all text-neutral-500">{source.requestedUrl}</p>
                )}
                {source.textTruncated && (
                  <p className="mt-1 text-amber-300/90">
                    The analyzed extract was truncated.
                  </p>
                )}
              </li>
            ))}
          </ul>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-line p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Found in submitted extracts
              </h3>
              <p className="mt-2 text-sm text-neutral-200">
                {receipt.foundAreas.join(" · ") || "No standard section labels detected"}
              </p>
            </div>
            <div className="rounded-lg border border-line p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Not found in submitted extracts
              </h3>
              <p className="mt-2 text-sm text-neutral-400">
                {receipt.notFoundAreas.join(" · ") || "None"}
              </p>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-neutral-500">{receipt.limitation}</p>

          {!example && (
            <div className="border-t border-line pt-5">
              <h3 className="text-sm font-semibold text-neutral-100">
                Add pages you want PostBeacon to use
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                Optional. PostBeacon never crawls the rest of your site automatically. Text
                from the URLs you enter below will be sent to {provider} for the new
                analysis.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {OPTIONAL_SOURCES.map((source) => (
                  <label key={source.kind} className="text-xs text-neutral-400">
                    {source.label}
                    <input
                      value={urls[source.kind] ?? ""}
                      onChange={(event) =>
                        setUrls((current) => ({
                          ...current,
                          [source.kind]: event.target.value,
                        }))
                      }
                      placeholder={source.placeholder}
                      className="mt-1.5 block min-h-11 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
                    />
                  </label>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button disabled={loading} onClick={() => onReanalyze(sources)}>
                  Re-analyze submitted sources
                </Button>
                <span className="text-xs text-neutral-600">
                  Replaces the current analysis and clears its old strategy.
                </span>
              </div>
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}
