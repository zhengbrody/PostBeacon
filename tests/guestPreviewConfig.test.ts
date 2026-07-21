import { afterEach, describe, expect, it, vi } from "vitest";
import {
  guestPreviewConfig,
  guestPreviewProviderCapability,
} from "@/lib/guestPreviewConfig";

const SECRET = "a-secure-test-secret-with-at-least-32-bytes";

function clearProviderEnv() {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_DEEPSEEK_FALLBACK", "");
  vi.stubEnv("GUEST_PREVIEW_ALLOW_DEEPSEEK", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://test.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
}

afterEach(() => vi.unstubAllEnvs());

describe("guest preview configuration", () => {
  it("is off by default and rejects an incomplete signing configuration", () => {
    clearProviderEnv();
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubEnv("GUEST_PREVIEW_ENABLED", "");
    expect(() => guestPreviewConfig()).toThrow(/unavailable/i);

    vi.stubEnv("GUEST_PREVIEW_ENABLED", "true");
    vi.stubEnv("GUEST_PREVIEW_SIGNING_SECRET", "short");
    expect(() => guestPreviewConfig()).toThrow(/unavailable/i);
  });

  it("selects the clear-policy provider and applies bounded defaults", () => {
    clearProviderEnv();
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubEnv("GUEST_PREVIEW_ENABLED", "true");
    vi.stubEnv("GUEST_PREVIEW_SIGNING_SECRET", SECRET);
    vi.stubEnv("GUEST_PREVIEW_GLOBAL_LIMIT", "999999");
    const config = guestPreviewConfig();
    expect(config).toMatchObject({
      provider: "openai",
      perVisitorLimit: 1,
      globalLimit: 25,
      windowSeconds: 86_400,
    });
  });

  it("requires a separate guest-data opt-in before DeepSeek can receive a preview", () => {
    clearProviderEnv();
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubEnv("DEEPSEEK_API_KEY", "test");
    vi.stubEnv("NEXT_PUBLIC_DEEPSEEK_FALLBACK", "true");
    vi.stubEnv("GUEST_PREVIEW_ENABLED", "true");
    vi.stubEnv("GUEST_PREVIEW_SIGNING_SECRET", SECRET);
    expect(() => guestPreviewConfig()).toThrow(/unavailable/i);

    vi.stubEnv("GUEST_PREVIEW_ALLOW_DEEPSEEK", "true");
    expect(guestPreviewConfig().provider).toBe("openai");
    expect(guestPreviewProviderCapability()).toMatchObject({
      enabled: true,
      primaryProvider: "openai",
      eligibleFallbackProviders: ["deepseek"],
      deepseek: {
        eligible: true,
        guestDataOptIn: true,
        mayReceivePreviewData: true,
        priorWarningRequired: true,
        region: "China",
      },
    });
  });

  it("uses the strict runtime quota parser in the public capability gate", () => {
    clearProviderEnv();
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubEnv("GUEST_PREVIEW_ENABLED", "true");
    vi.stubEnv("GUEST_PREVIEW_SIGNING_SECRET", SECRET);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://user:pass@test.upstash.io");
    expect(guestPreviewProviderCapability().enabled).toBe(false);
    expect(() => guestPreviewConfig()).toThrow(/unavailable/i);
  });
});
