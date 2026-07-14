import { describe, expect, it } from "vitest";
import { parseMetric } from "@/lib/coerce";

describe("parseMetric — pasted outcome numbers can never poison state", () => {
  it("parses plain and separator-formatted numbers", () => {
    expect(parseMetric("42")).toBe(42);
    expect(parseMetric(" 12,000 ")).toBe(12000);
    expect(parseMetric("1 234")).toBe(1234);
    expect(parseMetric("3.5")).toBe(3.5);
  });

  it("empty means 'not measured', never 0", () => {
    expect(parseMetric("")).toBeUndefined();
    expect(parseMetric("   ")).toBeUndefined();
  });

  it("unparseable and non-finite input becomes absent, not NaN/Infinity", () => {
    expect(parseMetric("a lot")).toBeUndefined();
    expect(parseMetric("1.2k")).toBeUndefined();
    expect(parseMetric("1e999")).toBeUndefined(); // Infinity
    expect(parseMetric("-5")).toBe(0); // clamped, still finite
  });
});
