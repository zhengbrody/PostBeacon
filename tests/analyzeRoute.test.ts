import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scrapeUrl: vi.fn(),
  analyzeScrapedPage: vi.fn(),
}));

vi.mock("@/lib/usage", () => ({
  guardRoute: vi.fn(async () => ({ userId: "00000000-0000-4000-8000-000000000001" })),
}));
vi.mock("@/lib/scrape", () => ({
  normalizeScrapeUrl: (raw: string) => {
    const value = raw.startsWith("http") ? raw : `https://${raw}`;
    if (value.includes("127.0.0.1")) throw new Error("blocked");
    return new URL(value).toString();
  },
  scrapeUrl: mocks.scrapeUrl,
}));
vi.mock("@/lib/analysis", () => ({
  analyzeScrapedPage: mocks.analyzeScrapedPage,
}));

import { POST } from "@/app/api/analyze/route";

const page = (url: string, text: string, rendered = false) => ({
  url,
  title: url.includes("pricing") ? "Pricing" : "Acme",
  description: "",
  headings: url.includes("pricing") ? ["Plans"] : ["Features"],
  text,
  rendered,
  textTruncated: false,
});

function request(evidenceSources: unknown[] = []) {
  return new NextRequest("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "example.com",
      provider: "openai",
      evidenceSources,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scrapeUrl.mockImplementation(async (url: string) => {
    if (url.includes("docs")) throw new Error("upstream detail must stay private");
    return page(url, url.includes("pricing") ? "The plan costs $20." : "Features for Acme");
  });
  mocks.analyzeScrapedPage.mockResolvedValue({
    profile: {
      name: "Acme",
      tagline: "",
      valueProp: "",
      audience: "",
      differentiators: [],
      features: [],
      tone: "",
      category: "",
    },
    facts: [
      {
        id: "name",
        field: "name",
        claim: "Acme",
        sourceType: "page",
        sourceUrl: "https://example.com/",
        status: "observed",
        confidence: 1,
        lastVerifiedAt: "2026-08-04T00:00:00.000Z",
      },
    ],
    questions: [],
    audit: {
      proposedObserved: 1,
      demotedObserved: 0,
      proposedUserConfirmed: 0,
      unknownWithClaim: 0,
    },
    meta: {
      provider: "openai",
      model: "test",
      fallbackFrom: "claude",
      promptVersion: "a5",
      generatedAt: "2026-08-04T00:00:00.000Z",
    },
  });
});

describe("POST /api/analyze evidence receipt", () => {
  it("returns actual provider provenance and honest partial-source failures", async () => {
    const response = await POST(
      request([
        { kind: "pricing", url: "https://example.com/pricing" },
        { kind: "docs", url: "https://example.com/docs" },
        { kind: "github", url: "http://127.0.0.1/repo" },
      ])
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.receipt.provider).toMatchObject({
      provider: "openai",
      fallbackFrom: "claude",
    });
    expect(body.receipt.checks).toMatchObject({
      urlsValidated: 3,
      pagesFetched: 2,
      claimsVerified: 1,
    });
    expect(body.receipt.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "pricing", status: "fetched" }),
        expect.objectContaining({
          kind: "docs",
          status: "failed",
          failure: "fetch-failed",
        }),
        expect.objectContaining({
          kind: "github",
          status: "failed",
          failure: "invalid-url",
        }),
      ])
    );
    expect(JSON.stringify(body)).not.toContain("upstream detail");
    expect(mocks.scrapeUrl).not.toHaveBeenCalledWith(expect.stringContaining("127.0.0.1"));
  });

  it("dedupes the primary URL and never analyzes the same page twice", async () => {
    const response = await POST(request([{ kind: "docs", url: "https://example.com/" }]));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mocks.scrapeUrl).toHaveBeenCalledTimes(1);
    expect(body.receipt.sources[1]).toMatchObject({
      status: "failed",
      failure: "duplicate",
    });
  });
});
