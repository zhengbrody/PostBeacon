import { NextRequest, NextResponse } from "next/server";
import { scrapeUrl } from "@/lib/scrape";
import { generateJson } from "@/lib/llm";
import type { Provider } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
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
      maxTokens: 1500,
      system:
        "You are a sharp product marketer. Extract a precise product profile from a scraped landing page. Be concrete and specific — no fluff. If the page is thin, infer sensibly from what's there.",
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
  "differentiators": string[], // 2-4 things that set it apart
  "features": string[],      // 3-6 key features
  "tone": string,            // suggested voice e.g. "playful, technical"
  "category": string         // e.g. "dev tool", "SaaS", "AI app"
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
