import { describe, expect, it } from "vitest";
import { shouldResetForAccountBoundary } from "@/lib/accountBoundary";

describe("account client-state boundary", () => {
  it("does not reset on the initial auth observation", () => {
    expect(shouldResetForAccountBoundary(undefined, null)).toBe(false);
  });

  it("clears an unowned browser draft when a signed-in identity arrives", () => {
    expect(shouldResetForAccountBoundary(undefined, "user-a")).toBe(true);
    expect(shouldResetForAccountBoundary(null, "user-a")).toBe(true);
  });

  it("resets when a signed-in user signs out or changes identity", () => {
    expect(shouldResetForAccountBoundary("user-a", null)).toBe(true);
    expect(shouldResetForAccountBoundary("user-a", "user-b")).toBe(true);
  });

  it("does not reset while the same user session refreshes", () => {
    expect(shouldResetForAccountBoundary("user-a", "user-a")).toBe(false);
  });
});
