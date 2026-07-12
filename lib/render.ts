/**
 * Headless render fallback for JS-heavy / SPA landing pages.
 *
 * Most pages are fine with the cheap static fetch in `scrape.ts`. React/Vite
 * SPAs, though, ship an empty shell that only fills in after JS runs — static
 * HTML comes back blank. When that happens `scrape.ts` calls `renderUrl()` to
 * get the post-render HTML from a headless renderer, then runs the SAME
 * extraction over it.
 *
 * Gated on SCRAPE_API_KEY — with no key, scraping stays static-only (no
 * regression). This is the swappable seam: to self-host headless Chromium
 * later, only this file changes. Default target is the Firecrawl scrape API;
 * override the endpoint with SCRAPE_API_URL if needed.
 */

import { fetchWithTimeout } from "./fetch";
import { assertPublicHttpUrl } from "./urlPolicy";

const RENDER_ENDPOINT =
  process.env.SCRAPE_API_URL || "https://api.firecrawl.dev/v1/scrape";

/** Whether a headless renderer is configured (key present). */
export function renderConfigured(): boolean {
  return !!process.env.SCRAPE_API_KEY;
}

/** Fetch a URL through a headless renderer and return its post-JS HTML. */
export async function renderUrl(url: string): Promise<string> {
  const key = process.env.SCRAPE_API_KEY;
  if (!key) throw new Error("SCRAPE_API_KEY not set");
  // Same SSRF policy as our own fetches: never hand the renderer a private or
  // internal target either (its requests come from infrastructure we pay for).
  assertPublicHttpUrl(url);

  const res = await fetchWithTimeout(
    RENDER_ENDPOINT,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["rawHtml"], onlyMainContent: false }),
    },
    25000
  );
  if (!res.ok) {
    throw new Error(`Render failed: ${res.status} ${res.statusText}`);
  }
  // Be tolerant of envelope shape across API versions.
  const json: any = await res.json();
  const data = json?.data ?? json;
  const html: string | undefined = data?.rawHtml ?? data?.html ?? data?.markdown;
  if (!html) throw new Error("Render returned no HTML");
  return html;
}
