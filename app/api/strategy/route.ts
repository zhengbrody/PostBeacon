import { NextRequest, NextResponse } from "next/server";
import { generateJson } from "@/lib/llm";
import { platformCatalogForStrategist, PLATFORMS } from "@/lib/platforms";
import { discoverChannels } from "@/lib/discovery";
import { authConfigured } from "@/lib/supabase/server";
import { getUserFromRequest } from "@/lib/usage";
import type {
  Provider,
  ProductProfile,
  MarketingStrategy,
  PlatformRecommendation,
  Confidence,
  AudienceSegment,
  GtmPhase,
  FounderTask,
  RiskItem,
  IterationMetric,
} from "@/lib/types";

const CONFIDENCE = new Set<Confidence>(["high", "medium", "low"]);
const TIERS = new Set(["primary", "secondary", "early-adopter"]);
const str = (v: any) => (typeof v === "string" ? v : "");
const arr = (v: any) => (Array.isArray(v) ? v : []);
const strList = (v: any, n: number) =>
  arr(v).map(str).filter(Boolean).slice(0, n);

export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    if (authConfigured() && !(await getUserFromRequest(req))) {
      return NextResponse.json(
        { error: "Sign in to continue.", code: "auth" },
        { status: 401 }
      );
    }

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

    // The strategist writes the full CMO plan AND scores every channel for fit.
    const strategy = await generateJson({
      provider,
      maxTokens: 8000,
      system:
        "You are a world-class Chief Marketing Officer writing the 0→1 launch plan for an indie/vibecoded product. You are decisive: you make real trade-offs instead of spreading effort evenly, you tell the founder where NOT to waste time, and you ground every call in this specific product and audience. No generic marketing advice, no platitudes. Write the way you'd brief a founder you respect — direct, concrete, occasionally blunt.",
      user: `PRODUCT PROFILE:
${JSON.stringify(profile, null, 2)}

CHANNEL UNIVERSE (score every one of these):
${JSON.stringify(catalog, null, 2)}

Produce a complete launch plan. Be specific to THIS product — a reader should not be able to swap in another product and have it still fit.

Return JSON exactly:
{
  "executiveSummary": string,   // 3-4 sentences: the read, the bet, where the leverage is
  "positioning": string,        // one sharp narrative to lead with everywhere
  "antiPositioning": string,    // how to NOT position it — the framing/claims to avoid, and why
  "overallStrategy": string,    // 3-5 sentences: the play, the sequencing logic, where to go all-in
  "coldStart": string,          // the very first traction path from 0 to the first real users
  "phases": [                   // 2-3 phases, sequenced
    { "window": string, "focus": string, "actions": string[] }  // e.g. window "Days 1–14"
  ],
  "audienceSegments": [         // exactly 3
    { "tier": "primary"|"secondary"|"early-adopter", "label": string, "description": string, "whereTheyHang": string }
  ],
  "recommendations": [          // ALL ${catalog.length} channels
    { "platformId": string, "score": number, "priority": "high"|"medium"|"low",
      "confidence": "high"|"medium"|"low", "rationale": string, "angle": string, "bestMove": string }
  ],
  "founderChecklist": [         // 6-9 concrete actions the founder personally does
    { "when": string, "task": string }   // "when": "Day 1" | "Daily" | "Week 1"
  ],
  "risks": [                    // 3-5 ways this launch goes sideways
    { "area": string, "risk": string, "mitigation": string }
  ],
  "iterationLoop": [            // 3-4 metrics to watch and how to react
    { "signal": string, "read": string, "ifWeak": string }
  ]
}

Rules:
- Score ALL ${catalog.length} channels 0-100 for fit to THIS product+audience. Be honest — low scores for poor fits. "bestMove" = the single highest-leverage action on that channel.
- At least one risk must be about avoiding looking like an ad / getting flagged on the strict communities (HN, Reddit, Lobsters).
- Concrete over generic everywhere. Real numbers, real communities, real actions.`,
    });

    // Normalize + enrich with platform names + effort (from the catalog), sort by score desc.
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
        effort: byId.get(r.platformId)!.effort,
        confidence: CONFIDENCE.has(r.confidence) ? r.confidence : undefined,
        rationale: str(r.rationale),
        angle: str(r.angle),
        bestMove: str(r.bestMove),
      }))
      .sort((a: PlatformRecommendation, b: PlatformRecommendation) => b.score - a.score);

    const audienceSegments: AudienceSegment[] = arr(strategy.audienceSegments)
      .map((s: any) => ({
        tier: TIERS.has(s?.tier) ? s.tier : "primary",
        label: str(s?.label),
        description: str(s?.description),
        whereTheyHang: str(s?.whereTheyHang),
      }))
      .filter((s: AudienceSegment) => s.label || s.description);

    const phases: GtmPhase[] = arr(strategy.phases)
      .map((p: any) => ({
        window: str(p?.window),
        focus: str(p?.focus),
        actions: strList(p?.actions, 6),
      }))
      .filter((p: GtmPhase) => p.focus || p.actions.length);

    const founderChecklist: FounderTask[] = arr(strategy.founderChecklist)
      .map((t: any) => ({ when: str(t?.when), task: str(t?.task) }))
      .filter((t: FounderTask) => t.task);

    const risks: RiskItem[] = arr(strategy.risks)
      .map((r: any) => ({
        area: str(r?.area),
        risk: str(r?.risk),
        mitigation: str(r?.mitigation),
      }))
      .filter((r: RiskItem) => r.risk);

    const iterationLoop: IterationMetric[] = arr(strategy.iterationLoop)
      .map((m: any) => ({
        signal: str(m?.signal),
        read: str(m?.read),
        ifWeak: str(m?.ifWeak),
      }))
      .filter((m: IterationMetric) => m.signal);

    const discoveries = await discoveriesPromise;

    const result: MarketingStrategy = {
      executiveSummary: str(strategy.executiveSummary),
      positioning: str(strategy.positioning),
      antiPositioning: str(strategy.antiPositioning),
      overallStrategy: str(strategy.overallStrategy),
      coldStart: str(strategy.coldStart),
      phases,
      audienceSegments,
      founderChecklist,
      risks,
      iterationLoop,
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
