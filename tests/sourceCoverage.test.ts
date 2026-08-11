import { describe, expect, it } from "vitest";
import { auditFactsAcrossPages } from "@/lib/facts";
import { buildAnalysisReceipt, normalizeAnalysisReceipt } from "@/lib/sourceCoverage";
import type { GenerationMeta } from "@/lib/types";

const meta: GenerationMeta = {
  provider: "openai",
  model: "test-model",
  fallbackFrom: "claude",
  promptVersion: "a5",
  generatedAt: "2026-08-04T00:00:00.000Z",
};

const landing = {
  url: "https://example.com/",
  title: "Acme",
  description: "Portfolio controls for founders",
  headings: ["Features", "Built for founders"],
  text: "Acme helps founders understand portfolio risk.",
  rendered: false,
  textTruncated: false,
};

const pricing = {
  url: "https://example.com/pricing",
  title: "Pricing",
  description: "Simple plans",
  headings: ["Pro plan"],
  text: "The Pro plan costs $20 per month.",
  rendered: true,
  textTruncated: true,
};

describe("multi-source evidence and receipt", () => {
  it("assigns a verified quote to the exact page that contains it", () => {
    const { facts, audit } = auditFactsAcrossPages(
      [
        {
          field: "pricing",
          claim: "$20 per month",
          evidence: "The Pro plan costs $20 per month.",
          status: "observed",
          confidence: 0.9,
        },
        {
          field: "notableClaims",
          claim: "10,000 customers",
          evidence: "Trusted by 10,000 customers",
          status: "observed",
          confidence: 0.9,
        },
      ],
      [landing, pricing]
    );

    expect(facts[0]).toMatchObject({ status: "observed", sourceUrl: pricing.url });
    expect(facts[1]).toMatchObject({ status: "inferred", sourceUrl: undefined });
    expect(audit.demotedObserved).toBe(1);
  });

  it("reports only completed work and never includes raw page text", () => {
    const { facts, audit } = auditFactsAcrossPages(
      [
        {
          field: "name",
          claim: "Acme",
          evidence: "Acme helps founders understand portfolio risk.",
          status: "observed",
          confidence: 0.9,
        },
      ],
      [landing, pricing]
    );
    const receipt = buildAnalysisReceipt({
      completedAt: "2026-08-04T00:00:00.000Z",
      meta,
      facts,
      audit,
      sources: [
        { kind: "primary", requestedUrl: "example.com", validated: true, page: landing },
        {
          kind: "pricing",
          requestedUrl: pricing.url,
          validated: true,
          page: pricing,
        },
        {
          kind: "docs",
          requestedUrl: "http://127.0.0.1/docs",
          validated: false,
          failure: "invalid-url",
        },
      ],
    });

    expect(receipt.checks).toMatchObject({
      urlsValidated: 2,
      pagesFetched: 2,
      claimsVerified: 1,
      claimsDemoted: 0,
    });
    expect(receipt.sources[1]).toMatchObject({
      status: "fetched",
      method: "rendered",
      textTruncated: true,
    });
    expect(receipt.sources[2]).toMatchObject({
      status: "failed",
      failure: "invalid-url",
    });
    expect(receipt.foundAreas).toEqual(
      expect.arrayContaining(["pricing", "features", "use cases"])
    );
    expect(receipt.notFoundAreas).toContain("documentation");
    expect(JSON.stringify(receipt)).not.toContain(pricing.text);
    expect(receipt.provider).toEqual(meta);
  });

  it("rejects malformed persisted receipts before UI rendering", () => {
    expect(
      normalizeAnalysisReceipt({
        provider: { provider: "untrusted" },
        sources: [{ kind: "primary", requestedUrl: "x", status: "fetched" }],
      })
    ).toBeNull();
    expect(
      normalizeAnalysisReceipt({ provider: { provider: "openai" }, sources: [] })
    ).toBeNull();
  });
});
