import * as cheerio from "cheerio";
import { renderUrl, renderConfigured } from "./render";
import { fetchWithTimeout } from "./fetch";

export interface ScrapedPage {
  url: string;
  title: string;
  description: string;
  headings: string[];
  text: string;
  rendered: boolean; // true if the headless renderer was used
}

/** Pull the signal a model needs out of a page's HTML. One path for static + rendered. */
function extract(html: string, url: string, rendered: boolean): ScrapedPage {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();

  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("title").first().text() ||
    "";
  const description =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";

  const headings: string[] = [];
  $("h1, h2, h3").each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, " ");
    if (t && headings.length < 30) headings.push(t);
  });

  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 6000);

  return {
    url,
    title: title.trim(),
    description: description.trim(),
    headings,
    text,
    rendered,
  };
}

/** An empty static extraction is the tell-tale of a client-rendered SPA shell. */
function looksEmpty(page: ScrapedPage): boolean {
  return page.text.length < 400 && page.headings.length === 0;
}

async function fetchStatic(url: string): Promise<string> {
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PostBeaconBot/1.0; +https://postbeacon.app)",
      },
    },
    15000
  );
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  return res.text();
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
  const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

  let staticPage: ScrapedPage | null = null;
  try {
    const html = await fetchStatic(url);
    staticPage = extract(html, url, false);
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
