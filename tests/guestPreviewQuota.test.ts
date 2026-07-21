import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicError } from "@/lib/errors";
import {
  configuredGuestPreviewQuotaStore,
  guestPreviewQuotaConfigured,
  GuestPreviewLimitError,
  MemoryGuestPreviewQuotaStore,
  parseGuestPreviewQuotaConnection,
  reserveGuestPreviewQuota,
  UpstashGuestPreviewQuotaStore,
  type GuestPreviewQuotaRequest,
  type GuestPreviewQuotaStore,
} from "@/lib/guestPreviewQuota";

const base: GuestPreviewQuotaRequest = {
  visitorKey: "opaque-visitor",
  nowMs: 1_000_000,
  windowSeconds: 300,
  perVisitorLimit: 1,
  globalLimit: 2,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("guest preview quota", () => {
  it("enforces visitor, global and new-window limits deterministically", async () => {
    const store = new MemoryGuestPreviewQuotaStore();
    expect((await store.consume(base)).allowed).toBe(true);
    expect(await store.consume(base)).toMatchObject({ allowed: false, reason: "visitor" });
    expect((await store.consume({ ...base, visitorKey: "visitor-2" })).allowed).toBe(true);
    expect(await store.consume({ ...base, visitorKey: "visitor-3" })).toMatchObject({
      allowed: false,
      reason: "global",
    });
    expect((await store.consume({ ...base, nowMs: base.nowMs + 300_000 })).allowed).toBe(
      true
    );
  });

  it("fails closed on storage errors and returns a typed 429 on exhaustion", async () => {
    const broken: GuestPreviewQuotaStore = {
      consume: vi.fn().mockRejectedValue(new Error("redis details")),
    };
    await expect(reserveGuestPreviewQuota(broken, base)).rejects.toMatchObject({
      status: 503,
      message: "Guest preview is temporarily unavailable.",
    });

    const denied: GuestPreviewQuotaStore = {
      consume: vi.fn().mockResolvedValue({
        allowed: false,
        reason: "global",
        retryAfterSeconds: 123,
      }),
    };
    await expect(reserveGuestPreviewQuota(denied, base)).rejects.toEqual(
      new GuestPreviewLimitError(123)
    );
  });

  it("never falls back to process memory when persistent configuration is absent", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect(configuredGuestPreviewQuotaStore()).toBeNull();
  });

  it.each([
    ["malformed", "not a URL"],
    ["cleartext", "http://quota.example.com"],
    ["credentialed", "https://user:pass@quota.example.com"],
  ])("rejects %s quota configuration in the shared parser", (_label, endpoint) => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", endpoint);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    expect(parseGuestPreviewQuotaConnection()).toBeNull();
    expect(guestPreviewQuotaConfigured()).toBe(false);
    expect(configuredGuestPreviewQuotaStore()).toBeNull();
  });

  it("normalizes the same credential-free HTTPS endpoint used at runtime", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://quota.example.com/");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    expect(parseGuestPreviewQuotaConnection()).toEqual({
      endpoint: "https://quota.example.com",
      token: "token",
    });
    expect(guestPreviewQuotaConfigured()).toBe(true);
    expect(configuredGuestPreviewQuotaStore()).toBeInstanceOf(
      UpstashGuestPreviewQuotaStore
    );
  });

  it("uses one Redis EVAL for atomic visitor + global reservation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ result: [1, "ok"] }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetch);
    const store = new UpstashGuestPreviewQuotaStore(
      "https://quota.example.com",
      "secret-token"
    );
    expect((await store.consume(base)).allowed).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const command = JSON.parse(String(init.body));
    expect(command.slice(0, 3)).toEqual(["EVAL", expect.any(String), "2"]);
    expect(command.join(" ")).not.toContain("http");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret-token" });
  });

  it("rejects cleartext and credentialed persistent quota endpoints", () => {
    expect(
      () => new UpstashGuestPreviewQuotaStore("http://quota.example.com", "token")
    ).toThrow();
    expect(
      () =>
        new UpstashGuestPreviewQuotaStore("https://user:pass@quota.example.com", "token")
    ).toThrow();
  });
});
