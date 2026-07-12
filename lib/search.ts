/**
 * Live web search for grounding discovery. Wraps a search API (Tavily by
 * default) behind one helper so swapping providers is a one-file change.
 *
 * Gated on SEARCH_API_KEY — returns [] (never throws) when unconfigured so
 * callers branch cleanly into an LLM-only fallback.
 */

import { fetchWithTimeout } from "./fetch";
import { asRecordList, asString } from "./coerce";

const SEARCH_ENDPOINT = process.env.SEARCH_API_URL || "https://api.tavily.com/search";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Whether a live search provider is configured. */
export function searchConfigured(): boolean {
  return !!process.env.SEARCH_API_KEY;
}

async function runQuery(query: string, key: string): Promise<SearchResult[]> {
  try {
    const res = await fetchWithTimeout(
      SEARCH_ENDPOINT,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        // api_key in body too: harmless redundancy that keeps older Tavily keys working.
        body: JSON.stringify({
          query,
          max_results: 5,
          search_depth: "basic",
          api_key: key,
        }),
      },
      12000
    );
    if (!res.ok) return [];
    const json: unknown = await res.json();
    return asRecordList((json as { results?: unknown })?.results)
      .map((r) => ({
        title: asString(r.title),
        url: asString(r.url),
        snippet: asString(r.content) || asString(r.snippet),
      }))
      .filter((r) => r.url);
  } catch {
    return []; // best-effort; a failed query just contributes nothing
  }
}

/** Run several queries, dedupe by URL, return the combined real results. */
export async function searchWeb(queries: string[]): Promise<SearchResult[]> {
  const key = process.env.SEARCH_API_KEY;
  if (!key) return [];

  const batches = await Promise.all(queries.map((q) => runQuery(q, key)));
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of batches.flat()) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}
