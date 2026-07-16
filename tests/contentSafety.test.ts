import { describe, expect, it } from "vitest";
import {
  auditDraftSafety,
  charBudget,
  platformCharLimit,
  unsafeDraftCount,
} from "@/lib/contentSafety";
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

describe("unsupported metrics — abbreviation formats models actually use (M21)", () => {
  const shapes = [
    "Already trusted by 10k users",
    "1M downloads in the first year",
    "$50k in revenue so far",
    "2k+ signups this month",
    "40% of teams switched to us",
    "3.2k customers rely on it",
  ];

  it.each(shapes)("flags %j without ledger support", (claim) => {
    const report = auditDraftSafety(post(claim), [], profile);
    expect(report.issues.map((issue) => issue.code)).toContain("unsupported-metric");
  });

  it("a ledger-confirmed abbreviated number still passes", () => {
    const report = auditDraftSafety(
      post("Already trusted by 10k users"),
      [fact("Already trusted by 10k users")],
      profile
    );
    expect(report.issues.map((issue) => issue.code)).not.toContain("unsupported-metric");
  });

  it("ordinary numbers that are not traction claims stay clean", () => {
    const report = auditDraftSafety(
      post("Paste one line at step 2 of the guide and record a 6-second setup GIF."),
      [],
      profile
    );
    expect(report.issues.map((issue) => issue.code)).not.toContain("unsupported-metric");
  });
});

describe("platform character contract (M21 over-limit gate)", () => {
  const longSingle = post("x".repeat(300), "A hook");
  const thread = post(
    `${"a".repeat(200)}\n\n${"b".repeat(200)}\n\n${"c".repeat(200)}`,
    "A thread opener"
  );

  it("charBudget mirrors exactly what Copy places on the clipboard", () => {
    const budget = charBudget(post("body", "hook"), 280);
    expect(budget.total).toBe("hook\n\nbody".length);
    expect(budget.fitsSingle).toBe(true);
    expect(budget.fitsThread).toBe(true);
  });

  it("blocks an X draft whose longest segment can never be posted", () => {
    const report = auditDraftSafety(longSingle, [], profile, "twitter");
    const overLimit = report.issues.find((issue) => issue.code === "over-limit");
    expect(overLimit).toBeDefined();
    expect(overLimit!.excerpt).toContain("of 280 characters");
    expect(report.ready).toBe(false);
  });

  it("a thread whose every segment fits is executable and passes", () => {
    const report = auditDraftSafety(thread, [], profile, "twitter");
    expect(report.issues.map((issue) => issue.code)).not.toContain("over-limit");
    const budget = charBudget(thread, 280);
    expect(budget.fitsSingle).toBe(false); // counter shows the thread hint instead
    expect(budget.fitsThread).toBe(true);
  });

  it("platforms without a hard limit never emit over-limit", () => {
    const report = auditDraftSafety(post("y".repeat(5000)), [], profile, "reddit");
    expect(report.issues.map((issue) => issue.code)).not.toContain("over-limit");
    expect(platformCharLimit("reddit")).toBeUndefined();
    expect(platformCharLimit("twitter")).toBe(280);
  });

  it("unsafeDraftCount applies the platform limit per channel", () => {
    expect(unsafeDraftCount([longSingle], [], profile, "twitter")).toBe(1);
    expect(unsafeDraftCount([longSingle], [], profile, "reddit")).toBe(0);
  });
});

describe("the demo passes its own bar (showcase must be executable)", () => {
  it("every demo X/Twitter draft passes the truth gate incl. the 280 contract", () => {
    const twitter = DEMO_PROJECT.result!.content.find(
      (channel) => channel.platformId === "twitter"
    )!;
    for (const demoPost of twitter.posts) {
      const report = auditDraftSafety(
        demoPost,
        DEMO_PROJECT.facts ?? [],
        DEMO_PROJECT.profile!,
        "twitter"
      );
      expect(report.issues).toEqual([]);
    }
  });
});
