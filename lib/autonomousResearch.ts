import { asRecord } from "./coerce";
import { assertPublicHttpUrl } from "./urlPolicy";

export interface AutonomousSearchConfig {
  queries: string[];
  domains: string[];
}

export interface AutonomousSearchReceipt extends AutonomousSearchConfig {
  status: "no-results" | "no-eligible-results" | "no-verified-sources" | "completed";
  searchedAt: string;
  resultCount: number;
  candidateCount: number;
}

const restrictedHosts = [
  "reddit.com",
  "redd.it",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "threads.net",
  "threads.com",
  "youtube.com",
  "youtu.be",
];

/** Conservative public-research boundary, not a general personal-data detector. */
export function containsPrivateResearchText(value: string): boolean {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    /* Keep malformed encoded data untrusted. */
  }
  return /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(^|[\s/(])@[\w.-]+|\b(?:bearer\s+\S+|(?:api[_ -]?key|token|password|secret)\s*[:=]\s*\S+)|[?&](?:code|auth|authorization|session|signature|sig|key|email|access[_-]?token|refresh[_-]?token)=[^\s&#]+|\b(?:sk-|sb_secret_)[a-z0-9_-]+|\b[a-z0-9_-]{40,}\b/i.test(
    decoded
  );
}

/** Exact host permission only; never wildcard/subdomain expansion or social scraping. */
export function normalizeApprovedDomain(raw: string): string | undefined {
  const domain = raw.trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return undefined;
  if (restrictedHosts.some((host) => domain === host || domain.endsWith(`.${host}`)))
    return undefined;
  try {
    return assertPublicHttpUrl(`https://${domain}/`).hostname === domain
      ? domain
      : undefined;
  } catch {
    return undefined;
  }
}

/** Invalid members reject the complete authorization, rather than broadening it. */
export function normalizeAutonomousSearch(
  raw: unknown
): AutonomousSearchConfig | undefined {
  const item = asRecord(raw);
  if (
    !Array.isArray(item.queries) ||
    !Array.isArray(item.domains) ||
    item.queries.length < 1 ||
    item.queries.length > 3 ||
    item.domains.length < 1 ||
    item.domains.length > 5
  )
    return undefined;
  const queries: string[] = [],
    domains: string[] = [];
  for (const value of item.queries) {
    if (typeof value !== "string") return undefined;
    const query = value.trim().replace(/\s+/g, " ");
    if (
      query.length < 3 ||
      query.length > 160 ||
      containsPrivateResearchText(query) ||
      /https?:\/\/|[\u0000-\u001f\u007f]/.test(value)
    )
      return undefined;
    if (!queries.includes(query)) queries.push(query);
  }
  for (const value of item.domains) {
    if (typeof value !== "string") return undefined;
    const domain = normalizeApprovedDomain(value);
    if (!domain) return undefined;
    if (!domains.includes(domain)) domains.push(domain);
  }
  return { queries, domains };
}

/** Search results remain untrusted. No private links, identity paths or permission redirects. */
export function autonomousSourceUrl(raw: string, domains: string[]): string | undefined {
  try {
    const url = assertPublicHttpUrl(raw);
    const path = decodeURIComponent(url.pathname);
    if (
      !domains.includes(url.hostname) ||
      !normalizeApprovedDomain(url.hostname) ||
      url.search ||
      url.hash ||
      containsPrivateResearchText(path) ||
      /\/(?:users?|profiles?|members?)\//i.test(path)
    )
      return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function normalizeAutonomousSearchReceipt(
  raw: unknown
): AutonomousSearchReceipt | undefined {
  const item = asRecord(raw),
    config = normalizeAutonomousSearch(raw);
  if (
    !config ||
    !["no-results", "no-eligible-results", "no-verified-sources", "completed"].includes(
      String(item.status)
    ) ||
    typeof item.searchedAt !== "string" ||
    !Number.isFinite(Date.parse(item.searchedAt)) ||
    typeof item.resultCount !== "number" ||
    !Number.isInteger(item.resultCount) ||
    item.resultCount < 0 ||
    item.resultCount > 15 ||
    typeof item.candidateCount !== "number" ||
    !Number.isInteger(item.candidateCount) ||
    item.candidateCount < 0 ||
    item.candidateCount > 2
  )
    return undefined;
  const status = item.status as AutonomousSearchReceipt["status"];
  if (
    (status === "no-results" && (item.resultCount !== 0 || item.candidateCount !== 0)) ||
    (status === "no-eligible-results" &&
      (item.resultCount === 0 || item.candidateCount !== 0)) ||
    ((status === "completed" || status === "no-verified-sources") &&
      item.candidateCount < 1) ||
    item.candidateCount > item.resultCount
  )
    return undefined;
  return {
    ...config,
    status,
    searchedAt: new Date(item.searchedAt).toISOString(),
    resultCount: item.resultCount,
    candidateCount: item.candidateCount,
  };
}
