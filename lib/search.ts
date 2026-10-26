/**
 * Live web search for grounding discovery. Wraps a search API (Tavily by
 * default) behind one helper so swapping providers is a one-file change.
 *
 * Gated on SEARCH_API_KEY — returns [] (never throws) when unconfigured so
 * callers branch cleanly into an LLM-only fallback.
 */

import { fetchWithTimeout } from "./fetch";
import { asRecord, asRecordList, asString } from "./coerce";
import { PublicError } from "./errors";
import {
  normalizeAutonomousSearch,
  type AutonomousSearchConfig,
} from "./autonomousResearch";

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

/** Bounded autonomous searches must distinguish a broken provider from no results.
 * This intentionally does not change legacy discovery's best-effort behavior. */
export async function searchApprovedPublicSources(
  config: AutonomousSearchConfig
): Promise<{ results: SearchResult[]; resultCount: number }> {
  const approved = normalizeAutonomousSearch(config);
  if (!approved)
    throw new PublicError("Approve bounded public queries and exact source domains first.");
  const key = process.env.SEARCH_API_KEY;
  if (!key)
    throw new PublicError(
      "Public research search is not configured. No search or model request was made.",
      503
    );
  const batches = await Promise.all(
    approved.queries.map(async (query) => {
      try {
        const deadline = Date.now() + 12000;
        const response = await fetchWithTimeout(
          SEARCH_ENDPOINT,
          {
            method: "POST",
            redirect: "error",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              query,
              max_results: 5,
              search_depth: "basic",
              include_domains: approved.domains,
              include_answer: false,
              include_raw_content: false,
            }),
          },
          12000
        );
        if (!response.ok || !response.body) throw new Error("Search unavailable");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        let expired = false;
        const timer = setTimeout(
          () => {
            expired = true;
            void reader.cancel().catch(() => undefined);
          },
          Math.max(1, deadline - Date.now())
        );
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 131_072) throw new Error("Search response exceeded bound");
            chunks.push(value);
          }
          if (expired || Date.now() > deadline) throw new Error("Search timed out");
        } finally {
          clearTimeout(timer);
          await reader.cancel().catch(() => undefined);
        }
        const buffer = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) {
          buffer.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const body = asRecord(JSON.parse(new TextDecoder().decode(buffer)));
        if (!Array.isArray(body.results)) throw new Error("Search response malformed");
        return asRecordList(body.results.slice(0, 5)).map((item) => ({
          title: asString(item.title),
          url: asString(item.url),
          snippet: asString(item.content) || asString(item.snippet),
        }));
      } catch {
        throw new PublicError(
          "Public research search failed. No replacement sources or demand evidence were invented.",
          502
        );
      }
    })
  );
  return {
    results: batches.flat(),
    resultCount: batches.reduce((sum, batch) => sum + batch.length, 0),
  };
}
