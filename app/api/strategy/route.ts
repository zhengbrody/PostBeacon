import { NextRequest, NextResponse } from "next/server";
import { generateJson } from "@/lib/llm";
import { platformCatalogForStrategist, PLATFORMS } from "@/lib/platforms";
import { discoverChannels } from "@/lib/discovery";
import type {
  Provider,
  ProductProfile,
  MarketingStrategy,
  PlatformRecommendation,
} from "@/lib/types";

export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const { profile, provider } = (await req.json()) as {
      profile?: ProductProfile;
      provider?: Provider;
    };
    if (!profile) {
      return NextResponse.json({ error: "Missing profile" }, { status: 400 });
    }

    const catalog = platformCatalogForStrategist();

    // Discovery runs concurrently with the main strategy call (best-effort).
    const discoveriesPromise = discoverChannels(profile, provider);

    // The strategist scores EVERY platform in the universe for this product.
    const strategy = await generateJson({
      provider,
      maxTokens: 4000,
      system:
        "You are a world-class Chief Marketing Officer planning a launch for an indie/vibecoded product. You are decisive and specific. You evaluate EVERY channel for fit, rank them, and tell the founder exactly where to focus to maximize reach with limited time.",
      user: `PRODUCT PROFILE:
${JSON.stringify(profile, null, 2)}

CHANNEL UNIVERSE (score every one of these):
${JSON.stringify(catalog, null, 2)}

Do this:
1. Write the core POSITIONING (one sharp narrative to lead with everywhere).
2. Write the OVERALL STRATEGY (3-5 sentences: the play, the sequencing logic, where to go all-in).
3. Score ALL ${catalog.length} channels 0-100 for fit to THIS product+audience, assign priority (high/medium/low), and give a one-line rationale + the specific marketing angle for each.

Return JSON exactly:
{
  "positioning": string,
  "overallStrategy": string,
  "recommendations": [
    { "platformId": string, "score": number, "priority": "high"|"medium"|"low", "rationale": string, "angle": string }
  ]
}
Include every platformId from the universe. Be honest — low scores for poor fits.`,
    });

    // Normalize + enrich with platform names, sort by score desc.
    const byId = new Map(PLATFORMS.map((p) => [p.id, p]));
    const recommendations: PlatformRecommendation[] = (
      strategy.recommendations || []
    )
      .filter((r: any) => byId.has(r.platformId))
      .map((r: any) => ({
        platformId: r.platformId,
        platformName: byId.get(r.platformId)!.name,
        score: Math.max(0, Math.min(100, Number(r.score) || 0)),
        priority: ["high", "medium", "low"].includes(r.priority)
          ? r.priority
          : "low",
        rationale: r.rationale || "",
        angle: r.angle || "",
      }))
      .sort((a: PlatformRecommendation, b: PlatformRecommendation) => b.score - a.score);

    const discoveries = await discoveriesPromise;

    const result: MarketingStrategy = {
      positioning: strategy.positioning || "",
      overallStrategy: strategy.overallStrategy || "",
      recommendations,
      discoveries,
    };

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Strategy failed" },
      { status: 500 }
    );
  }
}
