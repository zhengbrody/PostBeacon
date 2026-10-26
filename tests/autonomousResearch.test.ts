import { describe, expect, it } from "vitest";
import {
  autonomousSourceUrl,
  containsPrivateResearchText,
  normalizeApprovedDomain,
  normalizeAutonomousSearch,
  normalizeAutonomousSearchReceipt,
} from "@/lib/autonomousResearch";

describe("explicit public research permissions", () => {
  it("accepts only distinct bounded approved queries and exact domains", () => {
    expect(
      normalizeAutonomousSearch({
        queries: ["  scheduled   job monitoring  ", "scheduled job monitoring"],
        domains: ["EXAMPLE.ORG", "example.org"],
      })
    ).toEqual({ queries: ["scheduled job monitoring"], domains: ["example.org"] });
    expect(
      normalizeAutonomousSearch({
        queries: Array(4).fill("jobs"),
        domains: ["example.org"],
      })
    ).toBeUndefined();
    expect(
      normalizeAutonomousSearch({ queries: ["a".repeat(161)], domains: ["example.org"] })
    ).toBeUndefined();
    expect(
      normalizeAutonomousSearch({
        queries: ["jobs"],
        domains: Array(6).fill("example.org"),
      })
    ).toBeUndefined();
  });
  it.each([
    "reddit.com",
    "old.reddit.com",
    "x.com",
    "linkedin.com",
    "https://example.org",
    "*.example.org",
    "localhost",
    "127.0.0.1",
    "example.org/path",
    "example.org:443",
    "metadata.google.internal",
  ])("rejects restricted or non-host permission %s", (domain) => {
    expect(normalizeApprovedDomain(domain)).toBeUndefined();
  });
  it.each([
    "hello@example.org",
    "ask @someone about jobs",
    "token=secretvalue",
    "Bearer abc123",
    "https://example.org/private?code=123",
    "sk-super-secret",
    "a".repeat(45),
  ])("rejects private query %s without redaction into a different approval", (query) => {
    expect(
      normalizeAutonomousSearch({ queries: [query], domains: ["example.org"] })
    ).toBeUndefined();
  });
  it.each([
    "http://127.0.0.1",
    "https://sub.example.org/post",
    "https://example.org.evil.test/post",
    "https://example.org/post?token=private",
    "https://example.org/post?view=public",
    "https://example.org/post#private",
    "https://example.org/users/person",
    "https://example.org/%75sers/person",
    "https://example.org/%40person",
    "https://example.org/name%40example.org",
  ])("rejects source %s outside the minimal exact-host permission", (url) => {
    expect(autonomousSourceUrl(url, ["example.org"])).toBeUndefined();
  });
  it("does not treat ordinary product language as identity data", () => {
    expect(
      containsPrivateResearchText("Public scheduled-job reliability discussions")
    ).toBe(false);
    expect(autonomousSourceUrl("https://example.org/public-post", ["example.org"])).toBe(
      "https://example.org/public-post"
    );
  });
  it.each([
    "https://example.org/private?code=abc123",
    "https://example.org/?email=owner%40example.org",
    "Email owner%40example.org",
    "https://example.org/?signature=abc123",
  ])("rejects encoded identities and private links in excerpts: %s", (value) => {
    expect(containsPrivateResearchText(value)).toBe(true);
  });
  it("normalizes only consistent minimal receipts and drops provider metadata", () => {
    const receipt = {
      queries: ["scheduled jobs"],
      domains: ["example.org"],
      status: "completed",
      searchedAt: "2026-10-26T00:00:00Z",
      resultCount: 5,
      candidateCount: 2,
      raw: { api_key: "hidden" },
    };
    expect(normalizeAutonomousSearchReceipt(receipt)).toEqual({
      ...receipt,
      searchedAt: "2026-10-26T00:00:00.000Z",
      raw: undefined,
    });
    expect(
      normalizeAutonomousSearchReceipt({ ...receipt, status: "no-results" })
    ).toBeUndefined();
    expect(
      normalizeAutonomousSearchReceipt({ ...receipt, resultCount: 16 })
    ).toBeUndefined();
    expect(
      normalizeAutonomousSearchReceipt({ ...receipt, candidateCount: 3 })
    ).toBeUndefined();
  });
});
