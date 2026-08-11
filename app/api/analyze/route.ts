import { NextRequest, NextResponse } from "next/server";
import { normalizeScrapeUrl, scrapeUrl } from "@/lib/scrape";
import { analyzeScrapedPage } from "@/lib/analysis";
import { guardRoute } from "@/lib/usage";
import { analyzeBodySchema, apiError, parseBody, readJsonBody } from "@/lib/validate";
import { mapLimit } from "@/lib/async";
import { buildAnalysisReceipt, type SubmittedSourceResult } from "@/lib/sourceCoverage";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    // Require sign-in + enforce the daily cap (protects the model budget; the UI
    // gate alone wouldn't stop a direct API call).
    const guard = await guardRoute(req);
    if ("response" in guard) return guard.response;

    const { url, provider, evidenceSources } = parseBody(
      analyzeBodySchema,
      await readJsonBody(req)
    );

    // Validate every submitted URL before starting network/model work. The
    // primary source fails closed; optional evidence failures stay visible in
    // the receipt instead of silently disappearing.
    const primaryUrl = normalizeScrapeUrl(url);
    const seen = new Set([primaryUrl]);
    const prepared = evidenceSources.map((source) => {
      try {
        const canonical = normalizeScrapeUrl(source.url);
        if (seen.has(canonical)) {
          return { source, canonical, failure: "duplicate" as const };
        }
        seen.add(canonical);
        return { source, canonical };
      } catch {
        return { source, failure: "invalid-url" as const };
      }
    });

    const page = await scrapeUrl(primaryUrl);
    const evidenceResults = await mapLimit(prepared, 2, async (item) => {
      if (!item.canonical || item.failure) {
        return {
          kind: item.source.kind,
          requestedUrl: item.source.url,
          validated: item.failure === "duplicate",
          failure: item.failure,
        } satisfies SubmittedSourceResult;
      }
      try {
        const fetched = await scrapeUrl(item.canonical);
        const text = fetched.text.slice(0, 3000);
        return {
          kind: item.source.kind,
          requestedUrl: item.source.url,
          validated: true,
          page: {
            ...fetched,
            text,
            textTruncated: fetched.textTruncated || text.length < fetched.text.length,
          },
        } satisfies SubmittedSourceResult;
      } catch {
        return {
          kind: item.source.kind,
          requestedUrl: item.source.url,
          validated: true,
          failure: "fetch-failed",
        } satisfies SubmittedSourceResult;
      }
    });
    const { profile, facts, questions, meta, audit } = await analyzeScrapedPage(
      page,
      provider,
      evidenceResults.flatMap((source) => (source.page ? [source.page] : []))
    );
    const receipt = buildAnalysisReceipt({
      sources: [
        {
          kind: "primary",
          requestedUrl: url,
          validated: true,
          page,
        },
        ...evidenceResults,
      ],
      facts,
      audit,
      meta,
    });

    return NextResponse.json({
      profile,
      facts,
      questions,
      meta,
      receipt,
      page: { url: page.url, title: page.title },
    });
  } catch (err) {
    return apiError(err, "Analyze failed");
  }
}
