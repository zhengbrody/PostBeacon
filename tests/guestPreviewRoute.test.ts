import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuestPreviewProviderCapability } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  createGuestPreview: vi.fn(async () => {
    mocks.order.push("preview");
    return {
      source: { url: "https://example.com/", hostname: "example.com" },
      product: { name: "Acme", tagline: "", valueProp: "", audience: "" },
      channel: {
        platformId: "twitter",
        platformName: "X / Twitter",
        score: 80,
        rationale: "fit",
        angle: "angle",
      },
      draft: {
        hook: "hook",
        body: "body",
        imageSuggestion: "none",
        bestTime: "now",
        caveats: "",
        truthCheck: "passed",
      },
      provenance: {
        analysis: { provider: "openai", model: "test" },
        scoring: [{ provider: "openai", model: "test" }],
        content: { provider: "openai", model: "test" },
      },
    };
  }),
  reserveGuestPreviewQuota: vi.fn(async () => {
    mocks.order.push("quota");
  }),
  configuredGuestPreviewQuotaStore: vi.fn(
    (): { consume: ReturnType<typeof vi.fn> } | null => ({
      consume: vi.fn(),
    })
  ),
  guestPreviewProviderCapability: vi.fn((): GuestPreviewProviderCapability => ({
    enabled: true,
    primaryProvider: "openai",
    eligibleFallbackProviders: [],
    deepseek: {
      eligible: false,
      guestDataOptIn: false,
      mayReceivePreviewData: false,
      priorWarningRequired: false,
      region: "China",
      policyUrl: "https://example.com/deepseek-policy",
      notice: "DeepSeek notice",
    },
  })),
}));

vi.mock("@/lib/guestPreview", () => ({
  normalizeGuestPreviewUrl: (url: string) => `https://${url}/`,
  createGuestPreview: mocks.createGuestPreview,
}));
vi.mock("@/lib/guestPreviewConfig", () => ({
  guestPreviewConfig: () => ({
    secret: "a-secure-test-secret-with-at-least-32-bytes",
    provider: "openai",
    windowSeconds: 300,
    perVisitorLimit: 1,
    globalLimit: 2,
    tokenMaxAgeSeconds: 86_400,
  }),
  guestPreviewProviderCapability: mocks.guestPreviewProviderCapability,
}));
vi.mock("@/lib/guestPreviewQuota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/guestPreviewQuota")>();
  return {
    ...actual,
    configuredGuestPreviewQuotaStore: mocks.configuredGuestPreviewQuotaStore,
    reserveGuestPreviewQuota: mocks.reserveGuestPreviewQuota,
  };
});
vi.mock("@/lib/guestPreviewToken", () => ({
  resolveGuestPreviewIdentity: () => ({ id: "visitor", token: "signed", created: true }),
  guestPreviewQuotaIdentity: () => "opaque",
}));

import { POST } from "@/app/api/preview/route";
import { GuestPreviewLimitError } from "@/lib/guestPreviewQuota";

function request(
  headers: Record<string, string> = {},
  body: Record<string, unknown> = { url: "example.com" }
): NextRequest {
  return new NextRequest("http://localhost/api/preview", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

function deepseekCapability(): GuestPreviewProviderCapability {
  return {
    enabled: true,
    primaryProvider: "openai",
    eligibleFallbackProviders: ["deepseek"],
    deepseek: {
      eligible: true,
      guestDataOptIn: true,
      mayReceivePreviewData: true,
      priorWarningRequired: true,
      region: "China",
      policyUrl: "https://example.com/deepseek-policy",
      notice: "DeepSeek notice",
    },
  };
}

beforeEach(() => {
  mocks.order.length = 0;
  vi.clearAllMocks();
  mocks.configuredGuestPreviewQuotaStore.mockReturnValue({ consume: vi.fn() });
  mocks.reserveGuestPreviewQuota.mockImplementation(async () => {
    mocks.order.push("quota");
  });
  mocks.guestPreviewProviderCapability.mockReturnValue({
    enabled: true,
    primaryProvider: "openai",
    eligibleFallbackProviders: [],
    deepseek: {
      eligible: false,
      guestDataOptIn: false,
      mayReceivePreviewData: false,
      priorWarningRequired: false,
      region: "China",
      policyUrl: "https://example.com/deepseek-policy",
      notice: "DeepSeek notice",
    },
  });
});

describe("POST /api/preview", () => {
  it("reserves the hard quota before any scrape/model orchestration", async () => {
    const response = await POST(request({ origin: "http://localhost" }));
    expect(response.status).toBe(200);
    expect(mocks.order).toEqual(["quota", "preview"]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("fails closed without a persistent global store", async () => {
    mocks.configuredGuestPreviewQuotaStore.mockReturnValue(null);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.reserveGuestPreviewQuota).not.toHaveBeenCalled();
    expect(mocks.createGuestPreview).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("postbeacon_guest_preview=signed");
  });

  it("accepts a normal no-Origin same-site browser request", async () => {
    const response = await POST(request({ "sec-fetch-site": "same-site" }));
    expect(response.status).toBe(200);
    expect(mocks.reserveGuestPreviewQuota).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-site calls before quota or model work", async () => {
    const response = await POST(
      request({ origin: "https://attacker.example", "sec-fetch-site": "cross-site" })
    );
    expect(response.status).toBe(403);
    expect(mocks.reserveGuestPreviewQuota).not.toHaveBeenCalled();
    expect(mocks.createGuestPreview).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a mismatched or malformed Origin even with same-site metadata", async () => {
    for (const origin of ["https://sub.localhost", "null", "not a URL"]) {
      const response = await POST(request({ origin, "sec-fetch-site": "same-site" }));
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(mocks.reserveGuestPreviewQuota).not.toHaveBeenCalled();
  });

  it("returns a bounded 429 with Retry-After and never starts preview work", async () => {
    mocks.reserveGuestPreviewQuota.mockRejectedValueOnce(new GuestPreviewLimitError(77));
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("77");
    expect(mocks.createGuestPreview).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("postbeacon_guest_preview=signed");
  });

  it("persists the visitor identity when model orchestration fails", async () => {
    mocks.createGuestPreview.mockRejectedValueOnce(new Error("upstream details"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toContain("postbeacon_guest_preview=signed");
  });

  it("requires DeepSeek consent before quota or model work", async () => {
    mocks.guestPreviewProviderCapability.mockReturnValueOnce(deepseekCapability());
    const response = await POST(request({}, { url: "example.com" }));
    expect(response.status).toBe(400);
    expect(mocks.reserveGuestPreviewQuota).not.toHaveBeenCalled();
    expect(mocks.createGuestPreview).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("postbeacon_guest_preview=signed");
  });

  it("allows a disclosed DeepSeek path only with explicit consent", async () => {
    mocks.guestPreviewProviderCapability.mockReturnValueOnce(deepseekCapability());
    const response = await POST(request({}, { url: "example.com", deepseekConsent: true }));
    expect(response.status).toBe(200);
    expect(mocks.order).toEqual(["quota", "preview"]);
  });
});
