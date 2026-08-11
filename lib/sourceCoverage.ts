import type { FactAudit } from "./facts";
import type { ScrapedPage } from "./scrape";
import { asRecord, asString, asStringList, clipString } from "./coerce";
import type { AnalysisReceipt, EvidenceSourceKind, Fact, GenerationMeta } from "./types";

export interface SubmittedSourceResult {
  kind: EvidenceSourceKind;
  requestedUrl: string;
  validated: boolean;
  page?: ScrapedPage;
  failure?: "invalid-url" | "duplicate" | "fetch-failed";
}

const SOURCE_KINDS = new Set<EvidenceSourceKind>([
  "primary",
  "pricing",
  "docs",
  "changelog",
  "github",
  "other",
]);
const PROVIDERS = new Set(["claude", "openai", "deepseek"] as const);
const FAILURES = new Set(["invalid-url", "duplicate", "fetch-failed"] as const);
const boundedCount = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(10_000, Math.floor(number))) : 0;
};

/** Supabase meta and localStorage are untrusted JSON. Normalize the compact
 * receipt before any component indexes provider labels or renders arrays. */
export function normalizeAnalysisReceipt(value: unknown): AnalysisReceipt | null {
  const root = asRecord(value);
  const providerRaw = asRecord(root.provider);
  const provider = asString(providerRaw.provider) as "claude" | "openai" | "deepseek";
  if (!PROVIDERS.has(provider)) return null;
  const checks = asRecord(root.checks);
  const rawSources = Array.isArray(root.sources) ? root.sources.slice(0, 5) : [];
  const sources = rawSources.flatMap((raw) => {
    const source = asRecord(raw);
    const kind = asString(source.kind) as EvidenceSourceKind;
    const status = asString(source.status);
    const requestedUrl = clipString(source.requestedUrl, 2048);
    if (
      !SOURCE_KINDS.has(kind) ||
      !requestedUrl ||
      !["fetched", "failed"].includes(status)
    ) {
      return [];
    }
    const failure = asString(source.failure) as
      "invalid-url" | "duplicate" | "fetch-failed";
    return [
      {
        kind,
        requestedUrl,
        canonicalUrl: clipString(source.canonicalUrl, 2048) || undefined,
        title: clipString(source.title, 300) || undefined,
        status: status as "fetched" | "failed",
        method: ["static", "rendered"].includes(asString(source.method))
          ? (asString(source.method) as "static" | "rendered")
          : undefined,
        textTruncated:
          typeof source.textTruncated === "boolean" ? source.textTruncated : undefined,
        failure: FAILURES.has(failure) ? failure : undefined,
      },
    ];
  });
  if (!sources.length) return null;
  const fallback = asString(providerRaw.fallbackFrom) as "claude" | "openai" | "deepseek";
  const completedAt =
    clipString(root.completedAt, 40) || clipString(providerRaw.generatedAt, 40);
  if (!completedAt) return null;
  return {
    completedAt,
    sources,
    checks: {
      urlsValidated: boundedCount(checks.urlsValidated),
      pagesFetched: boundedCount(checks.pagesFetched),
      factsExtracted: boundedCount(checks.factsExtracted),
      claimsVerified: boundedCount(checks.claimsVerified),
      claimsInferred: boundedCount(checks.claimsInferred),
      claimsUnknown: boundedCount(checks.claimsUnknown),
      claimsDemoted: boundedCount(checks.claimsDemoted),
    },
    foundAreas: asStringList(root.foundAreas, 12).map((area) => area.slice(0, 80)),
    notFoundAreas: asStringList(root.notFoundAreas, 12).map((area) => area.slice(0, 80)),
    provider: {
      provider,
      model: clipString(providerRaw.model, 200),
      ...(PROVIDERS.has(fallback) ? { fallbackFrom: fallback } : {}),
      promptVersion: clipString(providerRaw.promptVersion, 100),
      generatedAt: clipString(providerRaw.generatedAt, 40),
    },
    limitation: clipString(root.limitation, 500),
  };
}

const AREAS = [
  { label: "pricing", pattern: /\b(pricing|price|plans?|free trial)\b|[$€£]\s?\d/i },
  {
    label: "documentation",
    pattern: /\b(documentation|docs|api reference|developer guide)\b/i,
  },
  {
    label: "changelog",
    pattern: /\b(changelog|release notes|what'?s new|product updates)\b/i,
  },
  { label: "GitHub", pattern: /github\.com|\b(open source|source code|repository)\b/i },
  { label: "features", pattern: /\b(features?|capabilities|what (?:it|we) does)\b/i },
  { label: "use cases", pattern: /\b(use cases?|who it'?s for|built for|made for)\b/i },
] as const;

function searchable(page: ScrapedPage): string {
  return [page.url, page.title, page.description, page.headings.join(" "), page.text].join(
    " "
  );
}

/** Construct the receipt only from completed server work. Loading UIs never
 * reconstruct these checks or animate them with timers. */
export function buildAnalysisReceipt(args: {
  sources: SubmittedSourceResult[];
  facts: Fact[];
  audit: FactAudit;
  meta: GenerationMeta;
  completedAt?: string;
}): AnalysisReceipt {
  const fetchedPages = args.sources.flatMap((source) => (source.page ? [source.page] : []));
  const corpus = fetchedPages.map(searchable).join("\n");
  const foundAreas = AREAS.filter((area) => area.pattern.test(corpus)).map(
    (area) => area.label
  );
  const found = new Set(foundAreas);

  return {
    completedAt: args.completedAt ?? new Date().toISOString(),
    sources: args.sources.map((source) => ({
      kind: source.kind,
      requestedUrl: source.requestedUrl,
      ...(source.page
        ? {
            canonicalUrl: source.page.url,
            title: source.page.title || undefined,
            status: "fetched" as const,
            method: source.page.rendered ? ("rendered" as const) : ("static" as const),
            textTruncated: source.page.textTruncated,
          }
        : {
            status: "failed" as const,
            failure: source.failure ?? ("fetch-failed" as const),
          }),
    })),
    checks: {
      urlsValidated: args.sources.filter((source) => source.validated).length,
      pagesFetched: fetchedPages.length,
      factsExtracted: args.facts.length,
      claimsVerified: args.facts.filter(
        (fact) => fact.status === "observed" || fact.status === "user-confirmed"
      ).length,
      claimsInferred: args.facts.filter((fact) => fact.status === "inferred").length,
      claimsUnknown: args.facts.filter((fact) => fact.status === "unknown").length,
      claimsDemoted: args.audit.demotedObserved,
    },
    foundAreas,
    notFoundAreas: AREAS.filter((area) => !found.has(area.label)).map((area) => area.label),
    provider: args.meta,
    limitation:
      "Coverage describes only the submitted page extracts. “Not found” does not mean the product or full site lacks that information.",
  };
}
