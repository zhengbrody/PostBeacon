import { generateJsonMeta } from "./llm";
import { ANTI_AI_RULES } from "./voice";
import { factsForPrompt } from "./facts";
import type { PlatformDef } from "./platforms";
import type {
  Fact,
  GenerationMeta,
  PlatformPlaybook,
  PlatformPost,
  ProductProfile,
  Provider,
} from "./types";

/** Bump when the content prompt changes (recorded on every output). */
export const GENERATE_PROMPT_VERSION = "g2";

export interface PlatformGeneration {
  posts: PlatformPost[];
  playbook: PlatformPlaybook;
  meta: GenerationMeta;
}

/**
 * Generate ready-to-post content AND a per-platform operating playbook for ONE
 * platform. Shared by /api/generate (all selected platforms) and /api/regenerate
 * (a single platform) so the prompt lives in exactly one place. Blends the
 * product's voice with the platform's native voice, enforces the anti-AI house
 * rules, asks for A/B hook variants, and writes full drafts for long-form
 * platforms.
 */
export async function generatePlatformPosts(
  profile: ProductProfile,
  p: PlatformDef,
  provider?: Provider,
  facts: Fact[] = []
): Promise<PlatformGeneration> {
  const ledger = factsForPrompt(facts);
  const { data, meta: callMeta } = await generateJsonMeta({
    provider,
    maxTokens: p.maxTokens ?? 2800,
    system: `You are a founder who is genuinely good at writing for ${p.name} — not an agency, not a marketer. ${p.guidance}
${p.persona ? `\nWrite as: ${p.persona}` : ""}

The product's own voice is: ${profile.tone || "clear, specific, human"}. Blend it with how people really write on ${p.name} — the platform's native format wins, the product's personality only colors word choice.

${ANTI_AI_RULES}

Competitor test: if a sentence could describe a competitor unchanged, add a product-specific fact or cut it.${
      ledger
        ? "\n\nFact discipline: state ESTABLISHED facts freely; hedge INFERRED ones; never invent numbers, users, or claims — where a specific is missing, write a [fill in: …] placeholder instead."
        : ""
    }`,
    user: `PRODUCT PROFILE:
${JSON.stringify(profile, null, 2)}${ledger ? `\n\n${ledger}` : ""}

Write ${p.postCount} ready-to-post piece(s) for ${p.name}. Each must read like a real person native to ${p.name} wrote it, and be copy-paste ready${
      p.longForm ? " — write the FULL piece, not an outline" : ""
    }. Also write a short operating playbook for actually running this channel.

Return JSON exactly:
{
  "posts": [
    { "hook": string, "hookVariants": string[], "body": string, "imageSuggestion": string, "bestTime": string, "caveats": string }
  ],
  "playbook": {
    "whyThisPlatform": string,
    "howToPost": string,
    "whatToAvoid": string,
    "firstReplies": string[],
    "postingWindow": string
  }
}
Field notes:
- "hook": the headline / first line / tagline (whatever leads on this platform)
- "hookVariants": 2-3 alternative hooks to A/B test (the same body works for each)
- "body": the full post, ready to paste
- "imageSuggestion": the specific visual to attach (or "none" if text-only is more native)
- "bestTime": ideal posting time (default to "${p.bestTime}")
- "caveats": the #1 platform-specific thing to NOT do
- "whyThisPlatform": one or two plain sentences on why this channel fits THIS product
- "howToPost": the concrete mechanics — where exactly to post, format, what to lead with
- "whatToAvoid": the move that gets you flagged or ignored on ${p.name}
- "firstReplies": 2-3 short replies the founder can drop in the comments to seed real discussion (in the founder's own voice, not salesy)
- "postingWindow": the specific best window to post (default to "${p.bestTime}")`,
  });

  const rawPosts = Array.isArray(data.posts) ? data.posts : [];
  const posts: PlatformPost[] = rawPosts.map((post: any) => ({
    hook: String(post?.hook || ""),
    hookVariants: Array.isArray(post?.hookVariants)
      ? post.hookVariants.map((h: any) => String(h)).filter(Boolean).slice(0, 3)
      : [],
    body: String(post?.body || ""),
    imageSuggestion: String(post?.imageSuggestion || ""),
    bestTime: String(post?.bestTime || p.bestTime),
    caveats: String(post?.caveats || ""),
  }));

  const pb = data.playbook || {};
  const playbook: PlatformPlaybook = {
    whyThisPlatform: String(pb.whyThisPlatform || ""),
    howToPost: String(pb.howToPost || ""),
    whatToAvoid: String(pb.whatToAvoid || ""),
    firstReplies: Array.isArray(pb.firstReplies)
      ? pb.firstReplies.map((r: any) => String(r)).filter(Boolean).slice(0, 3)
      : [],
    postingWindow: String(pb.postingWindow || p.bestTime),
  };

  const meta: GenerationMeta = {
    provider: callMeta.provider,
    model: callMeta.model,
    promptVersion: GENERATE_PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
  };

  return { posts, playbook, meta };
}
