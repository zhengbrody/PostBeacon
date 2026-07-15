import { describe, expect, it } from "vitest";
import { FIXTURES } from "./golden/fixtures";
import {
  pickClarifyingQuestions,
  quoteAppearsOnPage,
  verifyFacts,
  MAX_FACTS,
} from "@/lib/facts";
import {
  computeTotal,
  derivePriority,
  fallbackRecommendation,
  groundRecommendations,
  scoreAllPlatforms,
  toRecommendation,
  SCORE_WEIGHTS,
  MODEL_DIMS,
  type ScoreCall,
} from "@/lib/scoring";
import { PLATFORMS } from "@/lib/platforms";
import { lintVoice, BANNED_PHRASES } from "@/lib/voice";
import { DEMO_PROJECT } from "@/lib/demo";
import type { Fact, ScoreBreakdown } from "@/lib/types";

const page = FIXTURES[0].page; // envsync

// ---------------------------------------------------------------------------

describe("golden fixtures", () => {
  it("has at least 10 distinct product types", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(FIXTURES.map((f) => f.productType)).size).toBeGreaterThanOrEqual(10);
    expect(new Set(FIXTURES.map((f) => f.id)).size).toBe(FIXTURES.length);
  });

  it("every onPage snippet really appears on its page (self-consistency)", () => {
    for (const f of FIXTURES) {
      for (const quote of f.truth.onPage) {
        expect(quoteAppearsOnPage(quote, f.page), `${f.id}: "${quote}"`).toBe(true);
      }
      expect(f.page.text.length).toBeGreaterThan(300);
    }
  });
});

// ---------------------------------------------------------------------------

describe("fact faithfulness enforcement (verifyFacts)", () => {
  it("keeps observed only when the evidence quote verifies", () => {
    const facts = verifyFacts(
      [
        {
          field: "pricing",
          claim: "Team plan costs $6/seat/month",
          status: "observed",
          evidence: "$6 per seat per month",
          confidence: 0.9,
        },
      ],
      page
    );
    const f = facts.find((x) => x.field === "pricing")!;
    expect(f.status).toBe("observed");
    expect(f.sourceUrl).toBe(page.url);
    expect(f.evidence).toBe("$6 per seat per month");
  });

  it("uses an exact on-page claim when the model paraphrases its evidence field", () => {
    const facts = verifyFacts(
      [
        {
          field: "pricing",
          claim: "$6 per seat per month",
          status: "observed",
          evidence: "roughly six dollars for each teammate",
          confidence: 0.9,
        },
      ],
      page
    );
    const f = facts.find((item) => item.field === "pricing")!;
    expect(f.status).toBe("observed");
    expect(f.evidence).toBe("$6 per seat per month");
  });

  it("demotes a fabricated 'observed' quote to inferred (the model cannot lie its way to observed)", () => {
    const facts = verifyFacts(
      [
        {
          field: "audience",
          claim: "Used by 50,000 enterprise teams",
          status: "observed",
          evidence: "trusted by 50,000 enterprise teams worldwide", // not on page
          confidence: 0.95,
        },
      ],
      page
    );
    const f = facts.find((x) => x.field === "audience")!;
    expect(f.status).toBe("inferred");
    expect(f.evidence).toBeUndefined(); // the fake quote is not kept
    expect(f.confidence).toBeLessThanOrEqual(0.6);
  });

  it("never lets the model emit user-confirmed", () => {
    const facts = verifyFacts(
      [{ field: "name", claim: "envsync", status: "user-confirmed", confidence: 1 }],
      page
    );
    expect(facts.find((x) => x.field === "name")!.status).toBe("inferred");
  });

  it("discards claims attached to unknown instead of keeping plausible guesses", () => {
    const facts = verifyFacts(
      [{ field: "stage", claim: "Probably growing steadily", status: "unknown" }],
      page
    );
    const f = facts.find((x) => x.field === "stage")!;
    expect(f.status).toBe("unknown");
    expect(f.claim).toBe("");
    expect(f.confidence).toBe(0);
  });

  it("synthesizes honest unknowns for missing context fields and caps the ledger", () => {
    const facts = verifyFacts([], page);
    for (const field of ["stage", "conversionGoal", "assets"]) {
      const f = facts.find((x) => x.field === field);
      expect(f?.status).toBe("unknown");
    }
    const many = verifyFacts(
      Array.from({ length: 40 }, (_, i) => ({
        field: `extra${i}`,
        claim: `claim ${i}`,
        status: "inferred",
      })),
      page
    );
    expect(many.length).toBeLessThanOrEqual(MAX_FACTS);
  });

  it("rejects too-short evidence as non-verifying", () => {
    expect(quoteAppearsOnPage("$6", page)).toBe(false); // < 8 chars can't anchor a claim
  });
});

// ---------------------------------------------------------------------------

describe("clarifying questions (max 3, code-picked)", () => {
  const fact = (field: string, status: Fact["status"], confidence = 0.5): Fact => ({
    id: field,
    field,
    claim: status === "unknown" ? "" : "something",
    sourceType: "model",
    status,
    confidence,
    lastVerifiedAt: "",
  });

  it("asks all three when the context is unknown", () => {
    const qs = pickClarifyingQuestions([
      fact("stage", "unknown"),
      fact("conversionGoal", "unknown"),
      fact("assets", "unknown"),
    ]);
    expect(qs.map((q) => q.id)).toEqual(["stage", "conversionGoal", "assets"]);
    expect(qs.length).toBeLessThanOrEqual(3);
  });

  it("skips facts that are observed, user-confirmed, or strongly inferred", () => {
    const qs = pickClarifyingQuestions([
      fact("stage", "observed", 0.9),
      fact("conversionGoal", "user-confirmed", 1),
      fact("assets", "inferred", 0.9), // ≥ 0.7 → no question
    ]);
    expect(qs).toEqual([]);
  });

  it("asks about weakly inferred facts", () => {
    const qs = pickClarifyingQuestions([
      fact("stage", "inferred", 0.4),
      fact("conversionGoal", "observed", 0.9),
      fact("assets", "unknown"),
    ]);
    expect(qs.map((q) => q.id)).toEqual(["stage", "assets"]);
  });
});

// ---------------------------------------------------------------------------

const goodDims = (score = 7) =>
  Object.fromEntries(
    MODEL_DIMS.map((d) => [d, { score, reason: `${d} reason`, factIds: [] }])
  );

const rawRec = (platformId: string, score = 7) => ({
  platformId,
  dimensions: goodDims(score),
  rationale: "why",
  angle: "angle",
  bestMove: "do the thing",
  venue: "somewhere",
  confidence: "medium",
});

const NO_FACTS: Fact[] = [];

describe("deterministic scoring", () => {
  it("weights sum to 1", () => {
    const sum = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("computes the total in code with effort/risk inverted", () => {
    const dim = (score: number) => ({ score, reason: "" });
    const b: ScoreBreakdown = {
      audienceFit: dim(10),
      intentFit: dim(10),
      nativeContentFit: dim(10),
      founderAccess: dim(10),
      effort: dim(0), // zero cost
      risk: dim(0), // zero risk
      evidenceQuality: dim(10),
    };
    expect(computeTotal(b)).toBe(100);
    // Max risk + max effort drag the same ratings down deterministically.
    expect(computeTotal({ ...b, risk: dim(10), effort: dim(10) })).toBe(85);
  });

  it("derives priority from thresholds", () => {
    expect(derivePriority(70)).toBe("high");
    expect(derivePriority(69)).toBe("medium");
    expect(derivePriority(45)).toBe("medium");
    expect(derivePriority(44)).toBe("low");
  });

  it("earns evidenceQuality from cited fact statuses, not model claims", () => {
    const facts: Fact[] = [
      {
        id: "audience",
        field: "audience",
        claim: "devs",
        sourceType: "page",
        status: "observed",
        confidence: 0.9,
        lastVerifiedAt: "",
      },
      {
        id: "guess",
        claim: "a guess",
        sourceType: "model",
        status: "inferred",
        confidence: 0.5,
        lastVerifiedAt: "",
      },
    ];
    const platform = PLATFORMS[0];
    const raw = rawRec(platform.id);
    (raw.dimensions as any).audienceFit.factIds = ["audience"]; // observed → 2
    (raw.dimensions as any).intentFit.factIds = ["guess"]; // inferred → 1
    (raw.dimensions as any).nativeContentFit.factIds = ["nonexistent"]; // unknown id → 0
    const rec = toRecommendation(raw, platform, facts)!;
    expect(rec.breakdown!.evidenceQuality.score).toBe(3);
    expect(rec.score).toBe(computeTotal(rec.breakdown!)); // total always code-derived
    expect(rec.priority).toBe(derivePriority(rec.score));
  });

  it("invalidates 0-100-scale confusion instead of clamping it to a perfect 10", () => {
    const platform = PLATFORMS[0];
    const raw = rawRec(platform.id);
    (raw.dimensions as any).audienceFit.score = 85;
    expect(toRecommendation(raw, platform, NO_FACTS)).toBeNull();
    const slop = rawRec(platform.id);
    (slop.dimensions as any).audienceFit.score = 10.4; // rounding slop → clamped
    expect(toRecommendation(slop, platform, NO_FACTS)!.breakdown!.audienceFit.score).toBe(
      10
    );
  });

  it("effort always comes from the catalog, not the model", () => {
    const high = PLATFORMS.find((p) => p.effort === "high")!;
    const raw = rawRec(high.id);
    (raw.dimensions as any).effort = { score: 0, reason: "model claims it's free" };
    const rec = toRecommendation(raw, high, NO_FACTS)!;
    expect(rec.breakdown!.effort.score).toBe(8); // catalog cost for "high"
  });
});

// ---------------------------------------------------------------------------

describe("platform completeness guarantee (scoreAllPlatforms)", () => {
  const profile = { name: "X" } as any;

  it("perfect model output → exactly one rec per catalog platform", async () => {
    const call: ScoreCall = async () => ({
      recommendations: PLATFORMS.map((p) => rawRec(p.id)),
    });
    const { recommendations, diagnostics } = await scoreAllPlatforms(
      profile,
      NO_FACTS,
      call
    );
    expect(recommendations).toHaveLength(PLATFORMS.length);
    expect(new Set(recommendations.map((r) => r.platformId)).size).toBe(PLATFORMS.length);
    expect(diagnostics.fallbacks).toEqual([]);
    expect(diagnostics.firstPassValid).toBe(PLATFORMS.length);
  });

  it("repairs missing + duplicate + invalid + unknown entries via one scoped retry", async () => {
    const [a, b, c, ...rest] = PLATFORMS.map((p) => p.id);
    let retryIds: string[] = [];
    const call: ScoreCall = async (prompt) => {
      const first = prompt.user.includes(`"${c}"`) && prompt.user.includes(`"${a}"`);
      if (first && !retryIds.length) {
        retryIds = [a, b, c]; // will be re-requested
        return {
          recommendations: [
            rawRec(a, 85 as any), // invalid scale → dropped
            { platformId: b }, // missing dimensions → dropped
            rawRec(c),
            rawRec(c), // duplicate
            rawRec("made-up-platform"), // unknown id → never invented
            ...rest.map((id) => rawRec(id)),
          ],
        };
      }
      // Retry pass: return whatever was asked for.
      const askedIds = PLATFORMS.filter((p) => prompt.user.includes(`"${p.id}"`)).map(
        (p) => p.id
      );
      return { recommendations: askedIds.map((id) => rawRec(id, 9)) };
    };

    const { recommendations, diagnostics } = await scoreAllPlatforms(
      profile,
      NO_FACTS,
      call
    );
    expect(recommendations).toHaveLength(PLATFORMS.length);
    expect(new Set(recommendations.map((r) => r.platformId)).size).toBe(PLATFORMS.length);
    expect(recommendations.some((r) => r.platformId === "made-up-platform")).toBe(false);
    expect(diagnostics.duplicates).toBe(1);
    expect(diagnostics.invalid).toBeGreaterThanOrEqual(2);
    expect(diagnostics.recovered).toEqual(expect.arrayContaining([a, b]));
    expect(diagnostics.fallbacks).toEqual([]);
  });

  it("fills deterministic fallbacks when the retry also fails — still 19 unique", async () => {
    const call: ScoreCall = async () => {
      throw new Error("provider down");
    };
    const { recommendations, diagnostics } = await scoreAllPlatforms(
      profile,
      NO_FACTS,
      call
    );
    expect(recommendations).toHaveLength(PLATFORMS.length);
    expect(recommendations.every((r) => r.fallback)).toBe(true);
    expect(recommendations.every((r) => r.priority === "low")).toBe(true);
    expect(diagnostics.fallbacks).toHaveLength(PLATFORMS.length);
  });

  it("fallback entries are honest: flagged, low-evidence, never 'grounded'", () => {
    const fb = fallbackRecommendation(PLATFORMS[0], NO_FACTS);
    expect(fb.fallback).toBe(true);
    expect(fb.provenance).toBe("inferred");
    expect(fb.breakdown!.evidenceQuality.score).toBe(0);
    expect(fb.rationale).toMatch(/placeholder/i);
    expect(fb.score).toBe(computeTotal(fb.breakdown!));
  });
});

// ---------------------------------------------------------------------------

describe("source grounding (hallucinated links can never show as verified)", () => {
  const rec = (venue: string, bestMove = "") =>
    toRecommendation(
      { ...rawRec(PLATFORMS[0].id), venue, bestMove },
      PLATFORMS[0],
      NO_FACTS
    )!;

  const discovery = (name: string, url: string, validated: boolean) => ({
    name,
    url,
    why: "",
    source: "subreddit",
    validated,
  });

  it("grounds a venue that matches a VALIDATED discovery, with the discovery's URL", () => {
    const [g] = groundRecommendations(
      [rec("r/selfhosted")],
      [discovery("r/selfhosted", "https://reddit.com/r/selfhosted", true)]
    );
    expect(g.provenance).toBe("grounded");
    expect(g.sources).toEqual(["https://reddit.com/r/selfhosted"]);
  });

  it("never grounds from an unvalidated discovery", () => {
    const [g] = groundRecommendations(
      [rec("r/selfhosted")],
      [discovery("r/selfhosted", "https://reddit.com/r/selfhosted", false)]
    );
    expect(g.provenance).toBe("inferred");
    expect(g.sources).toBeUndefined();
  });

  it("leaves unmatched venues as inferred", () => {
    const [g] = groundRecommendations(
      [rec("some community the model made up")],
      [discovery("r/selfhosted", "https://reddit.com/r/selfhosted", true)]
    );
    expect(g.provenance).toBe("inferred");
  });

  it("model output cannot inject sources — toRecommendation ignores raw sources/provenance", () => {
    const raw = {
      ...rawRec(PLATFORMS[0].id),
      sources: ["https://evil.example/fake"],
      provenance: "grounded",
    };
    const r = toRecommendation(raw, PLATFORMS[0], NO_FACTS)!;
    expect(r.sources).toBeUndefined();
    expect(r.provenance).toBe("inferred");
  });
});

// ---------------------------------------------------------------------------

describe("banned-phrase linting", () => {
  it("catches seeded violations (phrases and rhythm patterns)", () => {
    const bad =
      "Introducing Acme — a game-changer that will seamlessly unlock your workflow. " +
      "Whether you're a founder or a developer, it's not just a tool — it's a movement.";
    const hits = lintVoice(bad);
    const phrases = hits.map((h) => h.phrase);
    expect(phrases).toEqual(
      expect.arrayContaining(["game-changer", "seamlessly", "unlock"])
    );
    expect(phrases.some((p) => p.includes("Introducing"))).toBe(true);
    expect(phrases.some((p) => p.includes("Whether you're"))).toBe(true);
  });

  it("passes clean, specific founder copy", () => {
    expect(
      lintVoice(
        "I kept losing backups to a cron job that died in March. This pings a URL when the job finishes; if the ping is late, you get a text. Free for 5 jobs."
      )
    ).toEqual([]);
  });

  it("the demo content (our quality bar) is violation-free", () => {
    for (const c of DEMO_PROJECT.result.content) {
      for (const post of c.posts) {
        const text = [post.hook, ...(post.hookVariants ?? []), post.body].join("\n");
        expect(lintVoice(text), `${c.platformId} post`).toEqual([]);
      }
    }
    // The prompt is built from the same list the linter checks — can't drift.
    for (const phrase of BANNED_PHRASES) expect(phrase).toBe(phrase.toLowerCase());
  });
});

// ---------------------------------------------------------------------------

describe("demo plan integrity (assembled with production functions)", () => {
  it("every demo recommendation's score is the deterministic total of its breakdown", () => {
    for (const r of DEMO_PROJECT.strategy.recommendations) {
      expect(r.breakdown, r.platformId).toBeDefined();
      expect(r.score).toBe(computeTotal(r.breakdown!));
      expect(r.priority).toBe(derivePriority(r.score));
    }
  });

  it("demo grounding: reddit is sourced via a validated discovery; HN stays inferred", () => {
    const reddit = DEMO_PROJECT.strategy.recommendations.find(
      (r) => r.platformId === "reddit"
    )!;
    expect(reddit.provenance).toBe("grounded");
    expect(reddit.sources?.[0]).toContain("reddit.com/r/selfhosted");
    const hn = DEMO_PROJECT.strategy.recommendations.find(
      (r) => r.platformId === "hackernews"
    )!;
    expect(hn.provenance).toBe("inferred");
  });

  it("demo facts show every provenance state and only users confirm", () => {
    const statuses = new Set(DEMO_PROJECT.facts.map((f) => f.status));
    expect(statuses.has("observed")).toBe(true);
    expect(statuses.has("inferred")).toBe(true);
    expect(statuses.has("user-confirmed")).toBe(true);
    for (const f of DEMO_PROJECT.facts) {
      if (f.status === "user-confirmed") expect(f.sourceType).toBe("user");
      if (f.status === "observed") expect(f.evidence?.length).toBeGreaterThan(7);
    }
  });
});
