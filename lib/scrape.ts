import * as cheerio from "cheerio";

export interface ScrapedPage {
  url: string;
  title: string;
  description: string;
  headings: string[];
  text: string;
}

/** Fetch a landing page and pull out the signal a model needs to understand it. */
export async function scrapeUrl(rawUrl: string): Promise<ScrapedPage> {
  const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let html: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PostBeaconBot/1.0; +https://postbeacon.app)",
      },
    });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    html = await res.text();
  } finally {
    clearTimeout(timeout);
  }

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

  const text = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);

  return { url, title: title.trim(), description: description.trim(), headings, text };
}
