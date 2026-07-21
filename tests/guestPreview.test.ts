import { describe, expect, it, vi } from "vitest";
import { PublicError } from "@/lib/errors";
import {
  createGuestPreview,
  GUEST_PREVIEW_MAX_GENERATION_ATTEMPTS,
  normalizeGuestPreviewUrl,
  type GuestPreviewDependencies,
} from "@/lib/guestPreview";
import { PLATFORMS } from "@/lib/platforms";
import type { Fact, PlatformPost, ProductProfile } from "@/lib/types";

const profile: ProductProfile = {
  name: "Acme",
  tagline: "Ship clearly",
  valueProp: "A focused launch tool",
  audience: "indie founders",
  differentiators: ["truth checks"],
  features: ["drafts"],
  tone: "plain",
  category: "SaaS",
  confidence: "high",
  publisherVoice: "brand",
};
const facts: Fact[] = [
  {
    id: "name",
    field: "name",
    claim: "Acme",
    evidence: "Acme helps founders ship clearly",
    sourceUrl: "https://example.com/",
    sourceType: "page",
    status: "observed",
    confidence: 1,
    lastVerifiedAt: "2026-07-21T00:00:00.000Z",
  },
];
const meta = { provider: "openai" as const, model: "test-model" };
const generationMeta = {
  ...meta,
  promptVersion: "test",
  generatedAt: "2026-07-21T00:00:00.000Z",
};
const recommendation = {
  platformId: PLATFORMS[0].id,
  platformName: PLATFORMS[0].name,
  score: 88,
  priority: "high" as const,
  rationale: "The audience is present.",
  angle: "Show the truth check.",
  venue: "Product Hunt",
  provenance: "inferred" as const,
};

function post(body = "A product-specific, factual body."): PlatformPost {
  return {
    hook: "A factual launch",
    body,
    imageSuggestion: "none",
    bestTime: "now",
    caveats: "No hype",
  };
}

function dependencies(generations: PlatformPost[][]): GuestPreviewDependencies {
  let call = 0;
  return {
    scrape: vi.fn().mockResolvedValue({
      url: "https://example.com/",
      title: "Acme",
      description: "",
      headings: [],
      text: "Acme helps founders ship clearly",
      rendered: false,
    }),
    analyze: vi.fn().mockResolvedValue({
      profile,
      facts,
      questions: [],
      meta: generationMeta,
      audit: {
        proposedObserved: 1,
        demotedObserved: 0,
        proposedUserConfirmed: 0,
        unknownWithClaim: 0,
      },
    }),
    score: vi.fn().mockResolvedValue({
      recommendations: [{ ...recommendation, fallback: true }, recommendation],
      runs: [meta],
    }),
    generate: vi.fn().mockImplementation(async () => ({
      posts: generations[Math.min(call++, generations.length - 1)],
      playbook: {
        whyThisPlatform: "",
        howToPost: "",
        whatToAvoid: "",
        firstReplies: [],
        postingWindow: "",
      },
      meta: generationMeta,
    })),
  };
}

describe("guest preview orchestration", () => {
  it("normalizes public URLs and rejects blocked targets before work starts", () => {
    expect(normalizeGuestPreviewUrl("example.com")).toBe("https://example.com/");
    expect(() => normalizeGuestPreviewUrl("http://127.0.0.1")).toThrow(PublicError);
    expect(() => normalizeGuestPreviewUrl("file:///etc/passwd")).toThrow(PublicError);
  });

  it("returns only one non-fallback channel and one truth-checked draft", async () => {
    const deps = dependencies([[post()]]);
    const result = await createGuestPreview("https://example.com/", "openai", deps);
    expect(result.channel).toMatchObject({
      platformId: recommendation.platformId,
      score: 88,
    });
    expect(result.source).toEqual({
      url: "https://example.com/",
      hostname: "example.com",
    });
    expect(result.draft).toMatchObject({ hook: "A factual launch", truthCheck: "passed" });
    expect(result.provenance).toEqual({ analysis: meta, scoring: [meta], content: meta });
    expect(result).not.toHaveProperty("facts");
    expect(result).not.toHaveProperty("strategy");
    expect(result.draft).not.toHaveProperty("hookVariants");
    expect(result.draft).not.toHaveProperty("playbook");
  });

  it("retries generation once when Truth Gate blocks the first result", async () => {
    const deps = dependencies([
      [post("Use [insert link] before posting.")],
      [post("A clean factual replacement.")],
    ]);
    const result = await createGuestPreview("https://example.com/", "openai", deps);
    expect(result.draft.body).toBe("A clean factual replacement.");
    expect(deps.generate).toHaveBeenCalledTimes(2);
  });

  it("never returns an unsafe draft after the bounded attempts", async () => {
    const deps = dependencies([[post("Use [insert link] before posting.")]]);
    await expect(
      createGuestPreview("https://example.com/", "openai", deps)
    ).rejects.toMatchObject({ status: 502 });
    expect(deps.generate).toHaveBeenCalledTimes(GUEST_PREVIEW_MAX_GENERATION_ATTEMPTS);
  });
});
