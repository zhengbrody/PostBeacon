import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicError } from "@/lib/errors";
import { PLATFORMS } from "@/lib/platforms";

// Route dependencies are mocked so the partial-success semantics are tested
// without any provider call: guard passes open, billing off, and the content
// generator succeeds or fails per platform however each test dictates.
vi.mock("@/lib/usage", () => ({
  guardRoute: vi.fn(async () => ({ userId: null })),
  getEntitlement: vi.fn(),
  canLaunch: vi.fn(),
  incrementLaunch: vi.fn(),
  FREE_LAUNCHES: 3,
}));
vi.mock("@/lib/supabase/server", () => ({ billingEnabled: () => false }));
vi.mock("@/lib/generate", () => ({
  GENERATE_PROMPT_VERSION: "g-test",
  generatePlatformPosts: vi.fn(),
}));

import { POST } from "@/app/api/generate/route";
import { generatePlatformPosts } from "@/lib/generate";

const [P0, P1, P2] = PLATFORMS.map((p) => p.id);

const okGeneration = (id: string) => ({
  posts: [
    { hook: `${id} hook`, body: "body", imageSuggestion: "", bestTime: "", caveats: "" },
  ],
  playbook: {
    whyThisPlatform: "",
    howToPost: "",
    whatToAvoid: "",
    firstReplies: [],
    postingWindow: "",
  },
  meta: {
    provider: "deepseek" as const,
    model: "deepseek-chat",
    promptVersion: "g-test",
    generatedAt: "2026-07-12T00:00:00.000Z",
  },
});

function request(platformIds: string[]): NextRequest {
  return new NextRequest("http://localhost/api/generate", {
    method: "POST",
    body: JSON.stringify({ profile: { name: "X" }, platformIds }),
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.clearAllMocks());

describe("POST /api/generate — partial success", () => {
  it("one failing platform never sinks the others", async () => {
    vi.mocked(generatePlatformPosts).mockImplementation(async (_p, platform) => {
      if (platform.id === P1) throw new Error("provider hiccup with secret details");
      return okGeneration(platform.id);
    });

    const res = await POST(request([P0, P1, P2]));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.content.map((c: any) => c.platformId).sort()).toEqual([P0, P2].sort());
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0].platformId).toBe(P1);
    // Internal error details never reach the client.
    expect(body.failures[0].error).not.toContain("secret details");
    // Calendar only schedules channels that actually have content.
    expect(body.schedule.every((s: any) => s.platformId !== P1)).toBe(true);
    // Every successful output carries its provenance stamp.
    expect(body.content.every((c: any) => c.meta?.promptVersion === "g-test")).toBe(true);
  });

  it("surfaces a PublicError message for the failed channel", async () => {
    vi.mocked(generatePlatformPosts).mockImplementation(async (_p, platform) => {
      if (platform.id === P0) throw new PublicError("Rate limited upstream.", 502);
      return okGeneration(platform.id);
    });
    const body = await (await POST(request([P0, P1]))).json();
    expect(body.failures[0].error).toBe("Rate limited upstream.");
  });

  it("returns 502 when every channel fails", async () => {
    vi.mocked(generatePlatformPosts).mockRejectedValue(new Error("down"));
    const res = await POST(request([P0, P1]));
    expect(res.status).toBe(502);
  });

  it("aborts wholesale on provider-config errors instead of 19 identical failures", async () => {
    vi.mocked(generatePlatformPosts).mockRejectedValue(
      new PublicError("No model API key configured.", 503)
    );
    const res = await POST(request([P0, P1]));
    expect(res.status).toBe(503);
  });
});
