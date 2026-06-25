import { generateJson } from "./llm";
import { searchWeb, searchConfigured } from "./search";
import { fetchWithTimeout } from "./fetch";
import type { DiscoveredChannel, ProductProfile, Provider } from "./types";

/**
 * Phase-2 discovery — surface SPECIFIC niche channels the static catalog can't
 * know: exact subreddits, Discord/Slack communities, "awesome-X" lists, forums,
 * and newsletters where this product's audience already gathers.
 *
 * Grounded path (SEARCH_API_KEY set): run real web searches, then have the model
 * SELECT from real results (never invent URLs) → these come back `validated`.
 * Fallback path (no key): the model names channels from its own knowledge, and
 * we tag each as validated only if its URL is reachable. Best-effort throughout.
 */
export async function discoverChannels(
  profile: ProductProfile,
  provider?: Provider
): Promise<DiscoveredChannel[]> {
  try {
    const grounded = searchConfigured()
      ? await searchWeb(buildQueries(profile))
      : [];
    const hasGrounding = grounded.length > 0;

    const data = await generateJson({
      provider,
      maxTokens: 1500,
      system: hasGrounding
        ? "You are a growth marketer. From the REAL search results provided, SELECT the 6-10 best niche channels where this product's exact audience gathers. Use ONLY URLs that appear in the results — never invent one. Prefer subreddits, Discord/Slack communities, 'awesome-X' GitHub lists, specialist forums, and newsletters."
        : "You are a growth marketer who knows exactly where a product's audience gathers online. Name CONCRETE, real channels — never a generic platform. Not 'Reddit' but the exact subreddit; not 'Discord' but a named community. Give plausible real URLs.",
      user: hasGrounding
        ? `Product profile:
${JSON.stringify(profile, null, 2)}

REAL search results — choose from these and keep their exact URLs:
${grounded
  .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet.slice(0, 200)}`)
  .join("\n")}

Return JSON: { "channels": [ { "name": string, "url": string, "why": string, "source": string } ] }
- name: the exact channel
- url: copy the matching URL from the results above verbatim
- why: one line on why this audience fits
- source: the channel type (subreddit | Discord | Slack | GitHub list | forum | newsletter)`
        : `Product profile:
${JSON.stringify(profile, null, 2)}

List 6-10 specific niche channels where THIS product's exact audience already hangs out. Prefer a mix of: subreddits, Discord/Slack communities, "awesome-X" GitHub lists, specialist forums, and newsletters worth pitching.

Return JSON: { "channels": [ { "name": string, "url": string, "why": string, "source": string } ] }
- name: the exact channel (e.g. "r/investing")
- url: a real, plausible URL (e.g. https://reddit.com/r/investing)
- why: one line on why this audience fits
- source: the channel type (subreddit | Discord | Slack | GitHub list | forum | newsletter)`,
    });

    const channels = Array.isArray(data.channels) ? data.channels : [];
    const normalized = channels
      .filter((c: any) => c?.name && c?.url)
      .slice(0, 10)
      .map((c: any) => ({
        name: String(c.name),
        url: String(c.url),
        why: String(c.why || ""),
        source: String(c.source || (hasGrounding ? "Tavily" : "AI")),
      })) as DiscoveredChannel[];

    const liveness = await Promise.all(normalized.map((c) => checkUrl(c.url)));

    if (hasGrounding) {
      // Grounded URLs come from a real search index → trust them, just drop any
      // that are now definitively gone (404/410).
      return normalized
        .filter((_, i) => liveness[i] !== "dead")
        .map((c) => ({ ...c, validated: true }));
    }
    // LLM-only: a URL the model invented is only trustworthy if it actually resolves.
    return normalized.map((c, i) => ({ ...c, validated: liveness[i] === "live" }));
  } catch {
    return []; // discovery is best-effort; never block the strategy on it
  }
}

/** A few targeted search queries derived from the product profile. */
function buildQueries(profile: ProductProfile): string[] {
  const cat = (profile.category || "").trim();
  const aud = (profile.audience || "").trim();
  return [
    `best ${cat} subreddits for ${aud}`,
    `${cat} Discord or Slack communities`,
    `awesome ${cat} github list`,
    `newsletters for ${aud || cat}`,
  ]
    .map((q) => q.replace(/\s+/g, " ").trim())
    .filter((q) => q.length > 8);
}

type Liveness = "live" | "dead" | "unknown";

/** Best-effort liveness: HEAD then GET, short timeout. 404/410 = dead; any other response = live. */
async function checkUrl(url: string): Promise<Liveness> {
  const probe = async (method: "HEAD" | "GET"): Promise<Liveness> => {
    try {
      const res = await fetchWithTimeout(url, { method, redirect: "follow" }, 6000);
      if (res.status === 404 || res.status === 410) return "dead";
      return "live"; // 403/401/405 etc. = exists but gated — still real
    } catch {
      return "unknown";
    }
  };
  const head = await probe("HEAD");
  if (head !== "unknown") return head;
  return probe("GET");
}
