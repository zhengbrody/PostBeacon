/**
 * fetch() with an AbortController timeout — for OPERATOR-CONFIGURED endpoints
 * only (Firecrawl/Tavily/Polar API URLs set via env by the deployer, which may
 * legitimately live on private infrastructure). Any URL that originates from
 * user input or model/search output MUST go through lib/safeFetch.ts instead,
 * which enforces the SSRF policy.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
