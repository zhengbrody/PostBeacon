import { afterEach, describe, expect, it, vi } from "vitest";
import { logError, redact } from "@/lib/log";

describe("redact — logs can never carry user data (M17 §7)", () => {
  it("strips email addresses", () => {
    expect(redact("magic link failed for founder+test@startup.io today")).toBe(
      "magic link failed for [email] today"
    );
  });

  it("strips URL query strings and fragments (tokens, personal params)", () => {
    expect(redact("GET https://x.io/cb?code=abc123&state=sekrit failed")).toBe(
      "GET https://x.io/cb?[redacted] failed"
    );
    expect(redact("redirect to /app#access_token=eyy")).toBe("redirect to /app#[redacted]");
  });

  it("strips bearer credentials and JWTs", () => {
    expect(redact("Authorization: Bearer abc.def-ghi rejected")).toBe(
      "Authorization: Bearer [redacted] rejected"
    );
    expect(redact("token eyJhbGciOi.eyJzdWIiOjEyMzQ1Njc4.SflKxwRJSMeKKF2QT4 expired")).toBe(
      "token [jwt] expired"
    );
  });

  it("strips API-key shapes", () => {
    expect(redact("upstream said key sk-abcdefghijklmnopqrstuvwx invalid")).toBe(
      "upstream said key [key] invalid"
    );
    expect(redact("secret_0123456789abcdef0123 rejected")).toBe("[key] rejected");
  });

  it("collapses newlines (log injection) and truncates long messages", () => {
    expect(redact("line1\nFAKE ENTRY\r\nline2")).toBe("line1 FAKE ENTRY line2");
    expect(redact("x".repeat(1000)).length).toBe(300);
  });
});

describe("logError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs only scope + error name + redacted message — no stacks, causes, or bodies", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("connect to https://db.internal?password=hunter2 as admin@x.io");
    err.stack = "SECRET STACK";
    logError("account.delete", err);
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0].join(" ");
    expect(line).toBe(
      "[account.delete] Error: connect to https://db.internal?[redacted] as [email]"
    );
    expect(line).not.toContain("SECRET STACK");
    expect(line).not.toContain("hunter2");
  });

  it("handles non-Error throwables without exploding", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("scope", "plain string with owner@site.dev");
    expect(spy.mock.calls[0][0]).toBe("[scope] string: plain string with [email]");
  });
});
