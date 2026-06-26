import { NextRequest, NextResponse } from "next/server";
import { scrapeUrl } from "@/lib/scrape";
import { generateJson } from "@/lib/llm";
import { guardRoute } from "@/lib/usage";
import type { Provider } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    // Require sign-in + enforce the daily cap (protects the model budget; the UI
    // gate alone wouldn't stop a direct API call).
    const guard = await guardRoute(req);
    if ("response" in guard) return guard.response;

    const { url, provider } = (await req.json()) as {
      url?: string;
      provider?: Provider;
    };
    if (!url) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    const page = await scrapeUrl(url);

    const profile = await generateJson({
      provider,
      maxTokens: 2000,
      system:
        "You are a sharp product strategist doing a first-pass diagnosis of a product from its landing page. Don't just lift the marketing copy — form a real point of view on what this is, who would actually pay attention, and why. Be concrete and specific, no fluff. Landing pages oversell; translate hype into the plain underlying truth. If the page is thin, infer sensibly and lower your confidence.",
      user: `Here is the scraped landing page.

URL: ${page.url}
TITLE: ${page.title}
META: ${page.description}
HEADINGS: ${page.headings.join(" | ")}
BODY (truncated): ${page.text}

Return a JSON object with exactly these keys:
{
  "name": string,            // product name
  "tagline": string,         // one crisp line
  "valueProp": string,       // the core promise, 1-2 sentences
  "audience": string,        // who it's for, specific
  "differentiators": string[], // 2-4 things that genuinely set it apart
  "features": string[],      // 3-6 key features
  "tone": string,            // the product's own voice, e.g. "playful, technical"
  "category": string,        // e.g. "dev tool", "SaaS", "AI app"
  "whatItIs": string,        // plain language, no marketing: what it actually does for a person
  "whyCare": string,         // the real pain or desire that makes someone care — be honest
  "useCase": string,         // one concrete moment where someone reaches for this
  "confidence": "high"|"medium"|"low", // how grounded this read is vs. inferred from a thin page
  "confidenceNote": string   // one line on what you had to infer (empty string if confidence is high)
}`,
    });

    return NextResponse.json({ profile, page: { url: page.url, title: page.title } });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Analyze failed" },
      { status: 500 }
    );
  }
}
