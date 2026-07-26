import { describe, expect, it } from "vitest";
import { PRODUCT_EVENTS, safeProductEventProperties } from "@/lib/productAnalytics";

describe("aggregate product analytics boundary", () => {
  it("defines the first-value and learning-loop funnel", () => {
    expect(Object.values(PRODUCT_EVENTS)).toEqual([
      "Guest Preview Started",
      "Guest Preview Completed",
      "Guest Preview Failed",
      "Guest Handoff Accepted",
      "Analysis Completed",
      "Strategy Completed",
      "Plan Generated",
      "Manual Publish Confirmed",
      "Outcome Recorded",
      "Learning Loop Completed",
    ]);
  });

  it("drops content, identity and arbitrary properties before analytics", () => {
    expect(
      safeProductEventProperties({
        provider: "openai",
        checkpoint: "24h",
        mode: "signed-in",
        source: "guest-handoff",
        url: "https://private.example",
        email: "person@example.com",
        userId: "user-secret",
        draft: "private draft",
        signups: 42,
      })
    ).toEqual({
      provider: "openai",
      checkpoint: "24h",
      mode: "signed-in",
      source: "guest-handoff",
    });
  });

  it("drops invalid values even when their property names are allowed", () => {
    expect(
      safeProductEventProperties({
        provider: "unknown-provider",
        checkpoint: "48h",
        mode: "admin",
        source: "email",
      })
    ).toEqual({});
  });
});
