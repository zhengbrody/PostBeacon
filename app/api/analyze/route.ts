import { NextRequest, NextResponse } from "next/server";
import { scrapeUrl } from "@/lib/scrape";
import { analyzeScrapedPage } from "@/lib/analysis";
import { guardRoute } from "@/lib/usage";
import { analyzeBodySchema, apiError, parseBody, readJsonBody } from "@/lib/validate";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    // Require sign-in + enforce the daily cap (protects the model budget; the UI
    // gate alone wouldn't stop a direct API call).
    const guard = await guardRoute(req);
    if ("response" in guard) return guard.response;

    const { url, provider } = parseBody(analyzeBodySchema, await readJsonBody(req));

    const page = await scrapeUrl(url);
    const { profile, facts, questions, meta } = await analyzeScrapedPage(page, provider);

    return NextResponse.json({
      profile,
      facts,
      questions,
      meta,
      page: { url: page.url, title: page.title },
    });
  } catch (err) {
    return apiError(err, "Analyze failed");
  }
}
