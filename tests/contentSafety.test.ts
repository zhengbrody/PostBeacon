import { describe, expect, it } from "vitest";
import { auditDraftSafety, unsafeDraftCount } from "@/lib/contentSafety";
import { DEMO_PROJECT } from "@/lib/demo";
import { platformSupportsThreadReplies } from "@/lib/platforms";
import type { Fact, PlatformPost, ProductProfile } from "@/lib/types";

const profile: ProductProfile = {
  name: "MindMarket",
  tagline: "Plain-English portfolio risk analysis",
  valueProp: "Understand portfolio concentration and downside exposure",
  audience: "Individual investors",
  differentiators: ["Transparent risk calculations"],
  features: ["Portfolio Health Score", "Scenario analysis"],
  tone: "direct",
  category: "financial analytics",
  publisherVoice: "brand",
};

const post = (body: string, hook = "Understand portfolio risk"): PlatformPost => ({
  hook,
  body,
  imageSuggestion: "",
  bestTime: "",
  caveats: "",
});

const fact = (claim: string): Fact => ({
  id: claim,
  claim,
  evidence: claim,
  sourceType: "page",
  status: "observed",
  confidence: 1,
  lastVerifiedAt: "2026-07-15T00:00:00Z",
});

describe("auditDraftSafety", () => {
  it("blocks the failure classes found in the MindMarket production test", () => {
    const report = auditDraftSafety(
      post(
        "I once heard an investor say this prevents losses. I'm a financial analyst, and one user told us it works for 1,000 users. Try it at [insert demo link here]. MindMarket can't model bonds yet."
      ),
      [],
      profile
    );

    expect(report.ready).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "placeholder",
        "brand-impersonation",
        "invented-anecdote",
        "invented-identity",
        "invented-testimonial",
        "unsupported-limitation",
        "unsupported-metric",
        "regulated-outcome",
      ])
    );
  });

  it("lets founder voice describe building, but still blocks invented biography", () => {
    const founderProfile = { ...profile, publisherVoice: "founder" as const };
    expect(
      auditDraftSafety(
        post("I built MindMarket to make portfolio concentration easier to understand."),
        [],
        founderProfile
      ).ready
    ).toBe(true);
    expect(
      auditDraftSafety(
        post("I'm a financial analyst, and I learned the hard way after losing money."),
        [],
        founderProfile
      ).issues.map((issue) => issue.code)
    ).toEqual(expect.arrayContaining(["invented-identity", "invented-anecdote"]));
  });

  it("accepts a limitation or metric only when verified evidence supports it", () => {
    const limitation = "MindMarket currently supports only US-listed stocks";
    const traction = "MindMarket serves 1,000 users";
    const report = auditDraftSafety(
      post(`${limitation}. ${traction}.`),
      [fact(limitation), fact(traction)],
      profile
    );
    expect(report.ready).toBe(true);
  });

  it("passes clean product-grounded copy and counts only unsafe drafts", () => {
    const clean = post(
      "See portfolio concentration and scenario exposure in plain English with MindMarket. If the ping doesn't show up, the monitor sends an alert."
    );
    const unsafe = post("Add your link here: [insert demo link here].");
    expect(auditDraftSafety(clean, [], profile)).toEqual({ ready: true, issues: [] });
    expect(unsafeDraftCount([clean, unsafe], [], profile)).toBe(1);
  });

  it("keeps the hand-verified example plan publishable", () => {
    expect(
      unsafeDraftCount(
        DEMO_PROJECT.result.content.flatMap((content) => content.posts),
        DEMO_PROJECT.facts,
        DEMO_PROJECT.profile
      )
    ).toBe(0);
  });
});

describe("platform reply mechanics", () => {
  it("keeps conversation starters off non-thread publishing channels", () => {
    expect(platformSupportsThreadReplies("hackernews")).toBe(true);
    expect(platformSupportsThreadReplies("reddit")).toBe(true);
    expect(platformSupportsThreadReplies("newsletters")).toBe(false);
    expect(platformSupportsThreadReplies("github")).toBe(false);
    expect(platformSupportsThreadReplies("medium")).toBe(false);
  });
});
