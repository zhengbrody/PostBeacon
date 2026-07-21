import { PublicError } from "./errors";
import { analyzeScrapedPage, type AnalysisOutcome } from "./analysis";
import { auditDraftSafety } from "./contentSafety";
import { generatePlatformPosts, type PlatformGeneration } from "./generate";
import { generateJsonMeta } from "./llm";
import { PLATFORMS, type PlatformDef } from "./platforms";
import { scoreAllPlatforms } from "./scoring";
import { scrapeUrl, type ScrapedPage } from "./scrape";
import { assertPublicHttpUrl } from "./urlPolicy";
import type {
  Fact,
  GuestPreviewResult,
  PlatformRecommendation,
  ProductProfile,
  Provider,
  ProviderRunMeta,
} from "./types";

export const GUEST_PREVIEW_MAX_GENERATION_ATTEMPTS = 2;

export interface GuestPreviewDependencies {
  scrape(url: string): Promise<ScrapedPage>;
  analyze(page: ScrapedPage, provider: Provider): Promise<AnalysisOutcome>;
  score(
    profile: ProductProfile,
    facts: Fact[],
    provider: Provider
  ): Promise<{ recommendations: PlatformRecommendation[]; runs: ProviderRunMeta[] }>;
  generate(
    profile: ProductProfile,
    platform: PlatformDef,
    provider: Provider,
    facts: Fact[]
  ): Promise<PlatformGeneration>;
}

const defaultDependencies: GuestPreviewDependencies = {
  scrape: scrapeUrl,
  analyze: analyzeScrapedPage,
  async score(profile, facts, provider) {
    const runs: ProviderRunMeta[] = [];
    const scored = await scoreAllPlatforms(profile, facts, async (prompt) => {
      const result = await generateJsonMeta({ provider, ...prompt });
      runs.push(result.meta);
      return result.data;
    });
    return { recommendations: scored.recommendations, runs };
  },
  generate: generatePlatformPosts,
};

/** Cheap syntax/hostname policy check before a quota unit is consumed. The
 * actual scrape still performs DNS-at-connect SSRF enforcement via safeFetch. */
export function normalizeGuestPreviewUrl(raw: string): string {
  const trimmed = raw.trim();
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return assertPublicHttpUrl(normalized).toString();
}

function runMeta(meta: ProviderRunMeta): ProviderRunMeta {
  return {
    provider: meta.provider,
    model: meta.model,
    ...(meta.fallbackFrom ? { fallbackFrom: meta.fallbackFrom } : {}),
  };
}

function selectBestChannel(recommendations: PlatformRecommendation[]): {
  recommendation: PlatformRecommendation;
  platform: PlatformDef;
} {
  const recommendation = recommendations.find(
    (candidate) =>
      !candidate.fallback && candidate.rationale.trim() && candidate.angle.trim()
  );
  const platform = recommendation
    ? PLATFORMS.find((candidate) => candidate.id === recommendation.platformId)
    : undefined;
  if (!recommendation || !platform) {
    throw new PublicError("The preview could not rank a usable channel. Try again.", 502);
  }
  return { recommendation, platform };
}

export async function createGuestPreview(
  normalizedUrl: string,
  provider: Provider,
  dependencies: GuestPreviewDependencies = defaultDependencies
): Promise<GuestPreviewResult> {
  const page = await dependencies.scrape(normalizedUrl);
  const sourceUrl = assertPublicHttpUrl(page.url);
  sourceUrl.hash = "";
  const analysis = await dependencies.analyze(page, provider);
  const scoring = await dependencies.score(analysis.profile, analysis.facts, provider);
  const { recommendation, platform } = selectBestChannel(scoring.recommendations);

  let safeGeneration: PlatformGeneration | null = null;
  let safePost: PlatformGeneration["posts"][number] | null = null;
  for (let attempt = 0; attempt < GUEST_PREVIEW_MAX_GENERATION_ATTEMPTS; attempt++) {
    const generation = await dependencies.generate(
      analysis.profile,
      platform,
      provider,
      analysis.facts
    );
    const post = generation.posts.find(
      (candidate) =>
        candidate.hook.trim() &&
        candidate.body.trim() &&
        auditDraftSafety(candidate, analysis.facts, analysis.profile, platform.id).ready
    );
    if (post) {
      safeGeneration = generation;
      safePost = post;
      break;
    }
  }
  if (!safeGeneration || !safePost) {
    throw new PublicError(
      "The preview could not produce a truth-checked draft. Try again later.",
      502
    );
  }

  return {
    source: {
      url: sourceUrl.toString(),
      hostname: sourceUrl.hostname,
    },
    product: {
      name: analysis.profile.name,
      tagline: analysis.profile.tagline,
      valueProp: analysis.profile.valueProp,
      audience: analysis.profile.audience,
      ...(analysis.profile.confidence ? { confidence: analysis.profile.confidence } : {}),
    },
    channel: {
      platformId: recommendation.platformId,
      platformName: recommendation.platformName,
      score: recommendation.score,
      rationale: recommendation.rationale,
      angle: recommendation.angle,
      ...(recommendation.venue ? { venue: recommendation.venue } : {}),
      ...(recommendation.provenance ? { provenance: recommendation.provenance } : {}),
    },
    draft: {
      hook: safePost.hook,
      body: safePost.body,
      imageSuggestion: safePost.imageSuggestion,
      bestTime: safePost.bestTime,
      caveats: safePost.caveats,
      truthCheck: "passed",
    },
    provenance: {
      analysis: runMeta(analysis.meta),
      scoring: scoring.runs.map(runMeta),
      content: runMeta(safeGeneration.meta),
    },
  };
}
