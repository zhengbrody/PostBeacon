import { generateJson } from "./llm";
import type { DiscoveredChannel, ProductProfile, Provider } from "./types";

/**
 * Phase-2 discovery — surface SPECIFIC niche channels the static catalog can't
 * know: exact subreddits, Discord/Slack communities, "awesome-X" lists, forums,
 * and newsletters where this product's audience already gathers.
 *
 * Default path uses the LLM's own knowledge (works with any configured model
 * key). When SEARCH_API_KEY is set, this is the place to add a live web-search
 * pass (Brave/SerpAPI/Tavily) and feed the results to the model for grounding.
 */
export async function discoverChannels(
  profile: ProductProfile,
  provider?: Provider
): Promise<DiscoveredChannel[]> {
  try {
    const data = await generateJson({
      provider,
      maxTokens: 1500,
      system:
        "You are a growth marketer who knows exactly where a product's audience gathers online. Name CONCRETE, real channels — never a generic platform. Not 'Reddit' but the exact subreddit; not 'Discord' but a named community. Give plausible real URLs.",
      user: `Product profile:
${JSON.stringify(profile, null, 2)}

List 6-10 specific niche channels where THIS product's exact audience already hangs out. Prefer a mix of: subreddits, Discord/Slack communities, "awesome-X" GitHub lists, specialist forums, and newsletters worth pitching.

Return JSON: { "channels": [ { "name": string, "url": string, "why": string, "source": string } ] }
- name: the exact channel (e.g. "r/investing", "r/portfolios")
- url: a real, plausible URL (e.g. https://reddit.com/r/investing)
- why: one line on why this audience fits
- source: the channel type (subreddit | Discord | Slack | GitHub list | forum | newsletter)`,
    });

    const channels = Array.isArray(data.channels) ? data.channels : [];
    return channels
      .filter((c: any) => c?.name && c?.url)
      .slice(0, 10)
      .map((c: any) => ({
        name: String(c.name),
        url: String(c.url),
        why: String(c.why || ""),
        source: String(c.source || "AI"),
      }));
  } catch {
    return []; // discovery is best-effort; never block the strategy on it
  }
}
