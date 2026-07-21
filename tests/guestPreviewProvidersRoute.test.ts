import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/providers/route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/providers guest preview capability", () => {
  it("returns the server-authored provider path and DeepSeek warning contract", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "openai-test");
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-test");
    vi.stubEnv("DEFAULT_PROVIDER", "openai");
    vi.stubEnv("NEXT_PUBLIC_DEEPSEEK_FALLBACK", "true");
    vi.stubEnv("GUEST_PREVIEW_ALLOW_DEEPSEEK", "true");
    vi.stubEnv("GUEST_PREVIEW_ENABLED", "true");
    vi.stubEnv("GUEST_PREVIEW_SIGNING_SECRET", "x".repeat(32));
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://quota.example.com");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");

    const response = await GET();
    const body = await response.json();
    expect(body.providers).toEqual(["openai", "deepseek"]);
    expect(body.guestPreviewEnabled).toBe(true);
    expect(body.guestPreview).toMatchObject({
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
    expect(body.guestPreview.deepseek.policyUrl).toMatch(/^https:\/\//);
    expect(body.guestPreview.deepseek.notice).toMatch(/confidential/i);
  });
});
