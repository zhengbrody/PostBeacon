import { NextRequest, NextResponse } from "next/server";
import { generateJson, generateJsonMeta, modelFor } from "@/lib/llm";
import { discoverChannels } from "@/lib/discovery";
import { guardRoute } from "@/lib/usage";
import { factsForPrompt } from "@/lib/facts";
import {
  groundRecommendations,
  scoreAllPlatforms,
  SCORING_PROMPT_VERSION,
} from "@/lib/scoring";
import { apiError, parseBody, readJsonBody, strategyBodySchema } from "@/lib/validate";
import { asRecordList, asString, asStringList } from "@/lib/coerce";
import type {
  MarketingStrategy,
  Confidence,
  AudienceSegment,
  GtmPhase,
  FounderTask,
  RiskItem,
  IterationMetric,
} from "@/lib/types";

const TIERS = new Set(["primary", "secondary", "early-adopter"]);
const str = asString;
const arr = asRecordList;
const strList = asStringList;

export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const guard = await guardRoute(req);
    if ("response" in guard) return guard.response;

    const { profile, provider, facts } = parseBody(
      strategyBodySchema,
      await readJsonBody(req)
    );
    const ledger = facts ?? [];

    // Three concurrent legs:
    //  1. the CMO narrative plan (positioning, phases, checklist, risks…)
    //  2. the per-dimension channel scoring pipeline (totals computed in code,
    //     completeness guaranteed by retry + fallback — see lib/scoring.ts)
    //  3. best-effort live discovery (whose validated hits later GROUND venues)
    const planPromise = generateJsonMeta({
      provider,
      maxTokens: 4000,
      system:
        "You are a world-class Chief Marketing Officer writing the 0→1 launch plan for an indie/vibecoded product. You are decisive: you make real trade-offs instead of spreading effort evenly, you tell the founder where NOT to waste time, and you ground every call in this specific product and audience. No generic marketing advice, no platitudes. Write the way you'd brief a founder you respect — direct, concrete, occasionally blunt. Respect the fact ledger: build on established facts, hedge inferred ones, and never assume what's marked unknown.",
      user: `PRODUCT PROFILE:
${JSON.stringify(profile, null, 2)}

${factsForPrompt(ledger)}

Produce the strategic plan (channel scoring happens separately — do NOT rank channels here). Be specific to THIS product — a reader should not be able to swap in another product and have it still fit.

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
- At least one risk must be about avoiding looking like an ad / getting flagged on the strict communities (HN, Reddit, Lobsters).
- Concrete over generic everywhere. Real numbers, real communities, real actions.`,
    });

    const scoringPromise = scoreAllPlatforms(profile, ledger, (prompt) =>
      generateJson({ provider, ...prompt })
    );
    const discoveriesPromise = discoverChannels(profile, provider);

    const [{ data: plan, meta: callMeta }, scoring, discoveries] = await Promise.all([
      planPromise,
      scoringPromise,
      discoveriesPromise,
    ]);

    // "grounded" provenance is earned post-hoc from validated discoveries —
    // never from model-written URLs.
    const recommendations = groundRecommendations(scoring.recommendations, discoveries);

    const audienceSegments: AudienceSegment[] = arr(plan.audienceSegments)
      .map((s) => ({
        tier: (TIERS.has(str(s.tier)) ? str(s.tier) : "primary") as AudienceSegment["tier"],
        label: str(s.label),
        description: str(s.description),
        whereTheyHang: str(s.whereTheyHang),
      }))
      .filter((s: AudienceSegment) => s.label || s.description);

    const phases: GtmPhase[] = arr(plan.phases)
      .map((p) => ({
        window: str(p.window),
        focus: str(p.focus),
        actions: strList(p.actions, 6),
      }))
      .filter((p: GtmPhase) => p.focus || p.actions.length);

    const founderChecklist: FounderTask[] = arr(plan.founderChecklist)
      .map((t) => ({ when: str(t.when), task: str(t.task) }))
      .filter((t: FounderTask) => t.task);

    const risks: RiskItem[] = arr(plan.risks)
      .map((r) => ({
        area: str(r.area),
        risk: str(r.risk),
        mitigation: str(r.mitigation),
      }))
      .filter((r: RiskItem) => r.risk);

    const iterationLoop: IterationMetric[] = arr(plan.iterationLoop)
      .map((m) => ({
        signal: str(m.signal),
        read: str(m.read),
        ifWeak: str(m.ifWeak),
      }))
      .filter((m: IterationMetric) => m.signal);

    const result: MarketingStrategy = {
      executiveSummary: str(plan.executiveSummary),
      positioning: str(plan.positioning),
      antiPositioning: str(plan.antiPositioning),
      overallStrategy: str(plan.overallStrategy),
      coldStart: str(plan.coldStart),
      phases,
      audienceSegments,
      founderChecklist,
      risks,
      iterationLoop,
      recommendations,
      discoveries,
      meta: {
        provider: callMeta.provider,
        model: modelFor(callMeta.provider),
        promptVersion: SCORING_PROMPT_VERSION,
        generatedAt: new Date().toISOString(),
      },
    };

    return NextResponse.json(result);
  } catch (err) {
    return apiError(err, "Strategy failed");
  }
}
