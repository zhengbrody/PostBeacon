import { describe, expect, it } from "vitest";
import { normalizeTrackedUrl } from "@/lib/trackedUrl";

describe("tracked live-post URL boundary", () => {
  it("keeps only absolute http(s) navigation targets", () => {
    expect(normalizeTrackedUrl(" https://x.com/example/status/1 ")).toBe(
      "https://x.com/example/status/1"
    );
    expect(normalizeTrackedUrl("http://news.ycombinator.com/item?id=1")).toBe(
      "http://news.ycombinator.com/item?id=1"
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "mailto:test@example.com",
    "/relative/post",
    "//example.com/post",
    "not a url",
    "",
  ])("makes %s inert", (value) => {
    expect(normalizeTrackedUrl(value)).toBeUndefined();
  });
});
