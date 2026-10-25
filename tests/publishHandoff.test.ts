import { describe, expect, it } from "vitest";
import { buildPublishHandoff } from "@/lib/publishHandoff";
import type { Fact, ProductProfile } from "@/lib/types";

const profile: ProductProfile = {
  name: "PostBeacon",
  tagline: "A growth workspace",
  valueProp: "Prepare and measure growth experiments",
  audience: "Product builders",
  differentiators: [],
  features: [],
  tone: "direct",
  category: "SaaS",
  publisherVoice: "brand",
};

const build = (
  platformId = "twitter",
  body = "Prepare a growth experiment and measure the result.",
  hook = "Meet PostBeacon",
  facts: Fact[] = []
) => buildPublishHandoff({ platformId, post: { hook, body }, facts, profile });

describe("buildPublishHandoff", () => {
  it("opens a fixed X intent with the exact complete draft and no credentials", () => {
    const result = build();
    expect(result.kind).toBe("prefilled-compose");
    if (result.kind !== "prefilled-compose") throw new Error("Expected compose");
    const url = new URL(result.href);
    expect(url.origin).toBe("https://twitter.com");
    expect(url.pathname).toBe("/intent/tweet");
    expect([...url.searchParams.keys()]).toEqual(["text"]);
    expect(url.searchParams.get("text")).toBe(result.text);
    expect(result.text).toBe(
      "Meet PostBeacon\n\nPrepare a growth experiment and measure the result."
    );
    expect(result.privacyNotice).toContain("browser history");
    expect(result.privacyNotice).toContain("does not publish");
  });

  it("encodes punctuation, line breaks, Unicode and parameter-like input as text", () => {
    const body = "中文 & + # ? = / 🚀\nhttps://example.com/?a=1&b=two";
    const result = build("twitter", body);
    expect(result.kind).toBe("prefilled-compose");
    if (result.kind === "unavailable") throw new Error("Expected handoff");
    const url = new URL(result.href);
    expect(url.searchParams.get("text")).toBe(`Meet PostBeacon\n\n${body}`);
    expect(url.searchParams.has("b")).toBe(false);
    expect(url.hash).toBe("");
  });

  it.each(["reddit", "linkedin", "github", "hackernews", "devto", "medium"])(
    "keeps %s on the existing fixed destination without sending content in query",
    (platformId) => {
      const result = build(platformId);
      expect(result.kind).toBe("copy-and-open");
      if (result.kind === "unavailable") throw new Error("Expected handoff");
      expect(new URL(result.href).search).toBe("");
      expect(result.text).toContain("Prepare a growth experiment");
      expect(result.privacyNotice).toContain("clipboard");
    }
  );

  it.each(["unknown", "constructor", "__proto__", "https://evil.example/"])(
    "rejects an unknown or prototype-like channel %s",
    (platformId) => expect(build(platformId).kind).toBe("unavailable")
  );

  it("does not invent a destination for known channels without one", () => {
    expect(build("threads").kind).toBe("unavailable");
  });

  it("blocks blank and unsafe drafts, including unsupported metrics", () => {
    expect(build("twitter", " ", " ").kind).toBe("unavailable");
    expect(build("twitter", "Try [insert URL]").kind).toBe("unavailable");
    expect(build("twitter", "Trusted by 10k users").kind).toBe("unavailable");
    expect(build("reddit", "Trusted by 10k users").kind).toBe("unavailable");
  });

  it("reuses ledger support rather than independently rejecting confirmed metrics", () => {
    const facts: Fact[] = [
      {
        id: "traction",
        claim: "Trusted by 10k users",
        status: "user-confirmed",
        sourceType: "user",
        confidence: 1,
        lastVerifiedAt: "2026-10-24T00:00:00.000Z",
      },
    ];
    expect(build("twitter", "Trusted by 10k users", "Meet PostBeacon", facts).kind).toBe(
      "prefilled-compose"
    );
  });

  it("keeps an executable multi-segment thread complete without opening a partial intent", () => {
    const body = `${"a".repeat(160)}\n\n${"b".repeat(160)}`;
    const result = build("twitter", body);
    expect(result.kind).toBe("copy-and-open");
    if (result.kind === "unavailable") throw new Error("Expected complete copy");
    expect(result.text).toBe(`Meet PostBeacon\n\n${body}`);
    expect(result.href).toBe("https://x.com/compose/post");
    expect(result.reason).toContain("thread");
  });

  it("blocks a segment over the platform limit instead of silently splitting it", () => {
    expect(build("twitter", "a".repeat(281)).kind).toBe("unavailable");
  });

  it("prefills at the single-post boundary and falls back without clipping above it", () => {
    expect(build("twitter", "a".repeat(277), "b").kind).toBe("prefilled-compose");
    const result = build("twitter", "a".repeat(278), "b");
    expect(result.kind).toBe("copy-and-open");
    if (result.kind === "unavailable") throw new Error("Expected complete copy");
    expect(result.text.length).toBe(281);
  });

  it("does not trim away whitespace to make an otherwise-overlong draft appear to fit", () => {
    const result = build("twitter", ` ${"a".repeat(277)} `, "b");
    expect(result.kind).toBe("copy-and-open");
    if (result.kind === "unavailable") throw new Error("Expected complete copy");
    expect(result.text).toBe(`b\n\n ${"a".repeat(277)} `);
  });

  it("falls back conservatively for non-ASCII weighted length, keeping text intact", () => {
    const result = build("twitter", "字".repeat(150), "");
    expect(result.kind).toBe("copy-and-open");
    if (result.kind === "unavailable") throw new Error("Expected complete copy");
    expect(result.text).toBe(`\n\n${"字".repeat(150)}`);
    expect(result.reason).toContain("weighted");
  });

  it("rejects an overlong encoded intent without clipping the original", () => {
    // Each astral character needs 12 encoded bytes. The content fits the
    // conservative post count but exceeds the application URL budget.
    const emoji = build("twitter", "🚀".repeat(130), "");
    expect(emoji.kind).toBe("copy-and-open");
    if (emoji.kind === "unavailable") throw new Error("Expected complete copy");
    expect(emoji.reason).toContain("URL would be too long");
    expect(emoji.text).toBe(`\n\n${"🚀".repeat(130)}`);
    expect(new URL(emoji.href).search).toBe("");
  });

  it("never mutates the supplied draft, profile or fact ledger", () => {
    const post = Object.freeze({ hook: "Meet PostBeacon", body: "Prepare an experiment." });
    const facts: Fact[] = [];
    const before = JSON.stringify({ post, profile, facts });
    buildPublishHandoff({ platformId: "twitter", post, profile, facts });
    expect(JSON.stringify({ post, profile, facts })).toBe(before);
  });
});
