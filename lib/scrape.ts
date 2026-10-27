import * as cheerio from "cheerio";
import { renderUrl, renderConfigured } from "./render";
import { BlockedUrlError, PublicError } from "./errors";
import { assertPublicHttpUrl } from "./urlPolicy";
import { safeFetch } from "./safeFetch";
import { autonomousSourceUrl, normalizeApprovedDomain } from "./autonomousResearch";

export interface ScrapedPage {
  url: string;
  title: string;
  description: string;
  headings: string[];
  text: string;
  rendered: boolean; // true if the headless renderer was used
  textTruncated: boolean; // receipt limitation; never pretend the extract was complete
}

/** Canonical syntax normalization shared by the route's preflight receipt and
 * the fetcher. Network/DNS policy is still enforced by safeFetch. */
export function normalizeScrapeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return assertPublicHttpUrl(url).toString();
}

/** Pull the signal a model needs out of a page's HTML. One path for static + rendered. */
function extract(
  html: string,
  url: string,
  rendered: boolean,
  responseTruncated = false
): ScrapedPage {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();

  const title =
    $('meta[property="og:title"]').attr("content") || $("title").first().text() || "";
  const description =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";

  const headings: string[] = [];
  $("h1, h2, h3").each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, " ");
    if (t && headings.length < 30) headings.push(t);
  });

  const fullText = $("body").text().replace(/\s+/g, " ").trim();
  const text = fullText.slice(0, 6000);

  return {
    url,
    title: title.trim(),
    description: description.trim(),
    headings,
    text,
    rendered,
    textTruncated: responseTruncated || fullText.length > text.length,
  };
}

/** An empty static extraction is the tell-tale of a client-rendered SPA shell. */
function looksEmpty(page: ScrapedPage): boolean {
  return page.text.length < 400 && page.headings.length === 0;
}

async function fetchStatic(
  url: string,
  timeoutMs = 15000,
  maxRedirects = 3,
  assertAllowedUrl?: (url: string) => void
) {
  const res = await safeFetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PostBeaconBot/1.0; +https://postbeacon.app)",
    },
    timeoutMs,
    maxRedirects,
    ...(assertAllowedUrl ? { assertAllowedUrl } : {}),
    maxBytes: 2_000_000,
    // A landing page must be text; anything else (pdf, zip, image) is useless
    // to the extractor and shouldn't be pulled at all.
    contentTypes: /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i,
  });
  if (!res.ok) {
    throw new PublicError(`Fetch failed: ${res.status} ${res.statusText}`.trim(), 502);
  }
  return res;
}

/**
 * Fetch a landing page and pull out the signal a model needs to understand it.
 *
 * Default path is a cheap static fetch. If that yields an empty shell (a sign of
 * a client-rendered SPA) and a renderer is configured, retry through the headless
 * renderer and extract from the post-JS HTML instead. Degrades gracefully to the
 * static result if rendering is unavailable or fails.
 */
export async function scrapeUrl(rawUrl: string): Promise<ScrapedPage> {
  const url = normalizeScrapeUrl(rawUrl);
  // Reject disallowed targets up front — before any fetch, and before the URL
  // could reach the headless renderer.

  let staticPage: ScrapedPage | null = null;
  try {
    const response = await fetchStatic(url);
    staticPage = extract(response.body, response.finalUrl, false, response.truncated);
    if (!looksEmpty(staticPage) || !renderConfigured()) return staticPage;
  } catch (err) {
    // Static fetch failed (timeout, network, 4xx). If we can render, fall
    // through and try that; otherwise rethrow so the caller surfaces it.
    if (!renderConfigured()) throw err;
  }

  // SPA shell (or static fetch failed) + renderer available → render & re-extract.
  try {
    const html = await renderUrl(url);
    const renderedPage = extract(html, url, true);
    // Keep whichever has more signal — rendering can occasionally do worse.
    if (staticPage && staticPage.text.length > renderedPage.text.length) {
      return staticPage;
    }
    return renderedPage;
  } catch (err) {
    if (staticPage) return staticPage; // degrade to the static result
    throw err;
  }
}

/** Explicit sources keep zero redirects. Autonomous exact-host authorization may
 * follow two same-origin canonical redirects; neither mode invokes a renderer. */
export async function scrapeStaticSource(
  url: string,
  options?: { approvedDomains: readonly string[] }
): Promise<ScrapedPage> {
  const initial = assertPublicHttpUrl(url);
  let assertAllowedUrl: ((url: string) => void) | undefined;
  if (options) {
    const domains = [...options.approvedDomains];
    if (
      !domains.length ||
      domains.some((domain) => normalizeApprovedDomain(domain) !== domain)
    )
      throw new BlockedUrlError("Approve exact public source hostnames first.");
    const visited = new Set<string>();
    // URL.search/hash omit empty delimiters; those are not part of a public
    // source capability either, even if they contain no value yet.
    const permittedSource = (candidate: string) =>
      /[?#]/.test(candidate) ? undefined : autonomousSourceUrl(candidate, domains);
    const check = (candidate: string) => {
      const permitted = permittedSource(candidate);
      if (!permitted || new URL(permitted).origin !== initial.origin)
        throw new BlockedUrlError(
          "This source redirect is outside the approved public origin."
        );
      if (visited.has(permitted))
        throw new BlockedUrlError("This source redirects in a loop.");
      visited.add(permitted);
    };
    // Enforce approval before handing the initial URL to any network seam.
    if (!permittedSource(initial.toString()))
      throw new BlockedUrlError("This source is outside the approved public hosts.");
    assertAllowedUrl = check;
  }
  const response = await fetchStatic(
    initial.toString(),
    8000,
    options ? 2 : 0,
    assertAllowedUrl
  );
  return extract(response.body, response.finalUrl, false, response.truncated);
}
