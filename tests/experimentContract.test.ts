import { describe, expect, it } from "vitest";
import {
  buildShareKit,
  explainDraft,
  projectExperimentContract,
} from "@/lib/experimentContract";
import type {
  Fact,
  PlatformContent,
  PlatformRecommendation,
  ProductProfile,
  SuccessContract,
} from "@/lib/types";

const profile: ProductProfile = {
  name: "PostBeacon",
  tagline: "One next move",
  valueProp: "Run one marketing experiment and learn from the result.",
  audience: "Solo software founders",
  differentiators: [],
  features: [],
  tone: "plain",
  category: "SaaS",
};

const facts: Fact[] = [
  {
    id: "audience",
    claim: "Solo software founders",
    evidence: "Built for solo software founders",
    sourceType: "page",
    status: "observed",
    confidence: 1,
    lastVerifiedAt: "2026-08-12T00:00:00.000Z",
  },
  {
    id: "guess",
    claim: "Founders probably prefer concise posts",
    sourceType: "model",
    status: "inferred",
    confidence: 0.5,
    lastVerifiedAt: "2026-08-12T00:00:00.000Z",
  },
  {
    id: "uncited",
    claim: "This must not appear as cited evidence",
    sourceType: "user",
    status: "user-confirmed",
    confidence: 1,
    lastVerifiedAt: "2026-08-12T00:00:00.000Z",
  },
];

const recommendation: PlatformRecommendation = {
  platformId: "twitter",
  platformName: "X / Twitter",
  score: 82,
  priority: "high",
  rationale: "The audience already discusses launches here.",
  angle: "Show the evidence-to-experiment loop.",
  bestMove: "Publish a three-part build update.",
  venue: "Build in public",
  provenance: "inferred",
  breakdown: {
    audienceFit: { score: 9, reason: "fit", factIds: ["audience"] },
    intentFit: { score: 8, reason: "intent", factIds: ["guess"] },
    nativeContentFit: { score: 8, reason: "native" },
    founderAccess: { score: 9, reason: "access" },
    effort: { score: 5, reason: "effort" },
    risk: { score: 4, reason: "risk" },
    evidenceQuality: { score: 7, reason: "quality" },
  },
};

const content: PlatformContent = {
  platformId: "twitter",
  platformName: "X / Twitter",
  posts: [
    {
      hook: "Marketing plans should end in a test.",
      body: "Post manually. Measure the result. Decide what changes next.",
      imageSuggestion: "Workspace screenshot",
      bestTime: "Tuesday morning",
      caveats: "Do not invent results.",
    },
  ],
};

const successContract: SuccessContract = {
  primaryGoal: "User feedback / conversations",
  primarySignal: "replies",
  minimumResult: 2,
  evaluationWindow: "72h",
};

describe("M25.3 experiment contract and share kit", () => {
  it("projects one visible variable from canonical plan state", () => {
    const contract = projectExperimentContract({
      profile,
      recommendation,
      content,
      post: content.posts[0],
      successContract,
    });
    expect(contract).toMatchObject({
      audience: "Solo software founders",
      venue: "Build in public",
      variable: "Hook",
      candidate: "Marketing plans should end in a test.",
      angle: "Show the evidence-to-experiment loop.",
    });
    expect(contract.decisionRule).toContain("Qualified replies / conversations ≥ 2 by 72h");
  });

  it("shows only fact IDs the scored recommendation actually cited", () => {
    const rationale = explainDraft({ facts, recommendation, content });
    expect(rationale.evidence.map((fact) => fact.id)).toEqual(["audience", "guess"]);
    expect(rationale.evidence.some((fact) => fact.id === "uncited")).toBe(false);
    expect(rationale.platformRule).toContain("build-in-public post");
    expect(rationale.inferenceNotes).toContain(
      "At least one cited strategy fact is inferred, not page-verified."
    );
    expect(rationale.inferenceNotes).toContain(
      "The venue is inferred; confirm its rules before posting."
    );
  });

  it("builds exactly three bounded X posts and an honest screenshot plan", () => {
    const kit = buildShareKit({
      profile,
      recommendation,
      content,
      post: content.posts[0],
      successContract,
    });
    expect(kit.screenshots).toHaveLength(3);
    expect(kit.xPosts).toHaveLength(3);
    expect(kit.xPosts.every((post) => post.length <= 280)).toBe(true);
    expect(kit.xPosts[2]).toContain("record what actually happened");
    expect(kit.linkedIn).toContain("No automatic posting and no invented results.");
    expect(kit.privacyReminder).toContain("hide email addresses");
  });

  it("labels missing legacy contract data instead of inventing it", () => {
    const legacy = projectExperimentContract({
      profile: { ...profile, audience: "" },
      content,
      post: { hook: "", body: "" },
    });
    expect(legacy.audience).toBe("Audience not confirmed");
    expect(legacy.candidate).toBe("No hook selected");
    expect(legacy.decisionRule).toContain("legacy plan");
  });
});
