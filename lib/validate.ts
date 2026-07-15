import { NextResponse } from "next/server";
import { z } from "zod";
import { PLATFORMS } from "./platforms";
import { PublicError, publicMessage, publicStatus } from "./errors";

/**
 * Runtime validation for every API request body. Server-only.
 *
 * Requests were previously trusted via `as` type assertions; everything here
 * exists to make the real wire contract enforced: bounded string/array sizes
 * (they get re-serialized into LLM prompts and autosaved rows), known enum
 * values only (provider, platform ids, copilot actions), and a hard cap on
 * the raw body size before JSON.parse.
 *
 * Validation failures throw PublicError(400) with a message that names the
 * offending field but never echoes the submitted value.
 */

const MAX_BODY_BYTES = 1_000_000;

/** Read + parse a JSON request body with a hard size cap. */
export async function readJsonBody(
  req: Request,
  maxBytes = MAX_BODY_BYTES
): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new PublicError("Request body is too large.", 413);
  const text = await req.text();
  if (text.length > maxBytes) throw new PublicError("Request body is too large.", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new PublicError("Request body must be valid JSON.");
  }
}

/** Zod issue → a safe message that names the field but never the value. */
function issueMessage(issue: z.ZodIssue): string {
  const path = issue.path.join(".") || "body";
  switch (issue.code) {
    case "too_big":
      return `"${path}" is too large`;
    case "too_small":
      return `"${path}" is missing or too short`;
    case "invalid_type":
      return `"${path}" has the wrong type`;
    case "invalid_enum_value":
      return `"${path}" has an unsupported value`;
    case "custom":
      return `"${path}": ${issue.message}`; // our own static refine messages
    default:
      return `"${path}" is invalid`;
  }
}

/** Parse or throw PublicError(400). */
export function parseBody<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new PublicError(`Invalid request: ${issueMessage(r.error.issues[0])}.`);
  }
  return r.data;
}

/** Uniform error response: PublicError messages pass through, the rest collapse. */
export function apiError(err: unknown, fallback: string): NextResponse {
  return NextResponse.json(
    { error: publicMessage(err, fallback) },
    { status: publicStatus(err) }
  );
}

// ---------------------------------------------------------------------------
// Shared pieces

const s = (max: number) => z.string().max(max);
const providerSchema = z.enum(["claude", "openai", "deepseek"]);
const confidenceSchema = z.enum(["high", "medium", "low"]);
const prioritySchema = z.enum(["high", "medium", "low"]);
const effortSchema = z.enum(["low", "medium", "high"]);

const PLATFORM_IDS = new Set(PLATFORMS.map((p) => p.id));

/** Deduped, bounded, known-only platform id list. */
const platformIdsSchema = z
  .array(s(64))
  .min(1)
  .max(60)
  .transform((ids) => Array.from(new Set(ids)))
  .refine((ids) => ids.length <= PLATFORMS.length, "too many platforms")
  .refine((ids) => ids.every((id) => PLATFORM_IDS.has(id)), "unknown platform");

const knownPlatformSchema = s(64).refine((id) => PLATFORM_IDS.has(id), "unknown platform");

/** ProductProfile as the wire accepts it: every string bounded; strings the
 *  server always emits default to "" so thin profiles don't 400. */
const profileSchema = z.object({
  name: s(300).default(""),
  tagline: s(1000).default(""),
  valueProp: s(5000).default(""),
  audience: s(3000).default(""),
  differentiators: z.array(s(1000)).max(16).default([]),
  features: z.array(s(1000)).max(16).default([]),
  tone: s(500).default(""),
  category: s(300).default(""),
  whatItIs: s(5000).optional(),
  whyCare: s(5000).optional(),
  useCase: s(5000).optional(),
  confidence: confidenceSchema.optional(),
  confidenceNote: s(2000).optional(),
  stage: s(500).optional(),
  conversionGoal: s(500).optional(),
  assets: s(1000).optional(),
  publisherVoice: z.enum(["brand", "founder"]).optional(),
});

/** Fact Ledger entries as the wire accepts them (M13). The server re-derives
 *  what matters (verifyFacts / evidenceQuality); this just bounds the shape. */
const factSchema = z.object({
  id: s(60),
  field: s(40).optional(),
  claim: s(500).default(""),
  evidence: s(300).optional(),
  sourceUrl: s(2048).optional(),
  sourceType: z.enum(["page", "user", "model", "search"]),
  status: z.enum(["observed", "user-confirmed", "inferred", "unknown"]),
  confidence: z.number().min(0).max(1),
  lastVerifiedAt: s(40).default(""),
});

const factsFieldSchema = z.array(factSchema).max(20).optional();

/** Output provenance stamp (M13). */
const generationMetaSchema = z.object({
  provider: providerSchema,
  model: s(80),
  fallbackFrom: providerSchema.optional(),
  promptVersion: s(20),
  generatedAt: s(40),
});

const scoreDimensionSchema = z.object({
  score: z.number().finite().min(0).max(10),
  reason: s(500).default(""),
  evidence: s(300).optional(),
  factIds: z.array(s(60)).max(6).optional(),
});

const breakdownSchema = z.object({
  audienceFit: scoreDimensionSchema,
  intentFit: scoreDimensionSchema,
  nativeContentFit: scoreDimensionSchema,
  founderAccess: scoreDimensionSchema,
  effort: scoreDimensionSchema,
  risk: scoreDimensionSchema,
  evidenceQuality: scoreDimensionSchema,
});

const recommendationSchema = z.object({
  platformId: s(64),
  platformName: s(200).default(""),
  score: z.number().finite().min(0).max(100),
  priority: prioritySchema,
  effort: effortSchema.optional(),
  confidence: confidenceSchema.optional(),
  rationale: s(4000).default(""),
  angle: s(4000).default(""),
  bestMove: s(4000).optional(),
  breakdown: breakdownSchema.optional(),
  venue: s(200).optional(),
  sources: z.array(s(2048)).max(3).optional(),
  provenance: z.enum(["grounded", "inferred"]).optional(),
  fallback: z.boolean().optional(),
});

/** MarketingStrategy as round-tripped from the client (plan-scoped copilot). */
const strategySchema = z.object({
  executiveSummary: s(4000).optional(),
  positioning: s(4000).default(""),
  antiPositioning: s(4000).optional(),
  overallStrategy: s(4000).default(""),
  coldStart: s(4000).optional(),
  phases: z
    .array(
      z.object({
        window: s(200).default(""),
        focus: s(1000).default(""),
        actions: z.array(s(1000)).max(8).default([]),
      })
    )
    .max(8)
    .optional(),
  audienceSegments: z
    .array(
      z.object({
        tier: z.enum(["primary", "secondary", "early-adopter"]),
        label: s(300).default(""),
        description: s(2000).default(""),
        whereTheyHang: s(1000).default(""),
      })
    )
    .max(6)
    .optional(),
  founderChecklist: z
    .array(z.object({ when: s(100).default(""), task: s(1000).default("") }))
    .max(15)
    .optional(),
  risks: z
    .array(
      z.object({
        area: s(200).default(""),
        risk: s(2000).default(""),
        mitigation: s(2000).default(""),
      })
    )
    .max(10)
    .optional(),
  iterationLoop: z
    .array(
      z.object({
        signal: s(500).default(""),
        read: s(1000).default(""),
        ifWeak: s(1000).default(""),
      })
    )
    .max(8)
    .optional(),
  recommendations: z.array(recommendationSchema).max(40).default([]),
  discoveries: z
    .array(
      z.object({
        name: s(300).default(""),
        url: s(2048).default(""),
        why: s(1000).default(""),
        source: s(100).default(""),
        validated: z.boolean().optional(),
      })
    )
    .max(20)
    .optional(),
  meta: generationMetaSchema.optional(),
});

const postSchema = z.object({
  hook: s(2000).default(""),
  hookVariants: z.array(s(2000)).max(8).optional(),
  body: s(40_000).default(""),
  imageSuggestion: s(2000).default(""),
  bestTime: s(500).default(""),
  caveats: s(2000).default(""),
});

const playbookSchema = z.object({
  whyThisPlatform: s(2000).default(""),
  howToPost: s(4000).default(""),
  whatToAvoid: s(2000).default(""),
  firstReplies: z.array(s(2000)).max(8).default([]),
  postingWindow: s(500).default(""),
});

/** GenerateResult as round-tripped from the client (copilot context). */
const resultSchema = z.object({
  content: z
    .array(
      z.object({
        platformId: s(64),
        platformName: s(200).default(""),
        posts: z.array(postSchema).max(12).default([]),
        playbook: playbookSchema.optional(),
        meta: generationMetaSchema.optional(),
      })
    )
    .max(30)
    .default([]),
  failures: z
    .array(
      z.object({
        platformId: s(64),
        platformName: s(200).default(""),
        error: s(300).default(""),
      })
    )
    .max(30)
    .optional(),
  schedule: z
    .array(
      z.object({
        day: z.number().int().min(-60).max(365),
        date: s(60).optional(),
        platformId: s(64),
        platformName: s(200).default(""),
        action: s(1000).default(""),
      })
    )
    .max(150)
    .default([]),
});

// ---------------------------------------------------------------------------
// Per-route bodies

export const analyzeBodySchema = z.object({
  url: z.string().min(4).max(2048),
  provider: providerSchema.optional(),
});

export const strategyBodySchema = z.object({
  profile: profileSchema,
  provider: providerSchema.optional(),
  facts: factsFieldSchema,
});

export const generateBodySchema = z.object({
  profile: profileSchema,
  platformIds: platformIdsSchema,
  provider: providerSchema.optional(),
  facts: factsFieldSchema,
});

export const regenerateBodySchema = z.object({
  profile: profileSchema,
  platformId: knownPlatformSchema,
  provider: providerSchema.optional(),
  facts: factsFieldSchema,
});

/** Workspace slice the copilot needs for evidence refs (bounded). */
/** Outcome metric off the wire: absent/null/non-finite all mean "not measured". */
const metricSchema = z
  .number()
  .nullish()
  .transform((v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined));

const copilotWorkspaceSchema = z.object({
  experiments: z
    .array(
      z.object({
        id: s(80),
        platformId: s(64),
        platformName: s(200).default(""),
        community: s(200).default(""),
        angle: s(300).default(""),
        variant: s(2000).default(""),
        hypothesis: s(400).default(""),
        trackedUrl: s(2048).optional(),
        publishedAt: s(40).default(""),
        status: z.enum(["live", "analyzed", "stopped"]).catch("live"),
        postIdx: z.number().int().min(0).max(50).catch(0),
        outcomes: z
          .array(
            z.object({
              id: s(80),
              checkpoint: z.enum(["24h", "72h", "manual"]),
              recordedAt: s(40).default(""),
              // Metrics tolerate null: a NaN that ever reached a saved plan
              // serialized to null, and one bad historical outcome must not
              // 400 every copilot call for that project. Non-finite → absent.
              impressions: metricSchema,
              replies: metricSchema,
              clicks: metricSchema,
              signups: metricSchema,
              revenue: metricSchema,
              qualitativeFeedback: s(4000).optional(),
            })
          )
          .max(6)
          .default([]),
        verdict: z
          .object({
            call: z.enum(["supported", "promising", "weak", "no-signal"]),
            reason: s(500).default(""),
            advice: s(500).default(""),
            decidedAt: s(40).default(""),
          })
          .optional(),
      })
    )
    .max(30)
    .default([]),
  // The model never needs the task log; accept-and-drop whatever arrives.
  taskLog: z
    .array(z.unknown())
    .max(200)
    .transform(() => [] as never[])
    .default([]),
});

/** Product memory as the copilot context accepts it (bounded). */
const memorySchema = z.object({
  tone: s(200).optional(),
  bannedClaims: z.array(s(200)).max(20).default([]),
  angles: z
    .array(
      z.object({
        angle: s(300),
        platformId: s(64),
        verdict: z.enum(["winning", "losing"]),
        experimentId: s(80),
        at: s(40).default(""),
      })
    )
    .max(20)
    .default([]),
  rewriteFeedback: z
    .array(
      z.object({
        platformId: s(64),
        direction: z.enum(["accepted", "rejected"]),
        summary: s(120),
        at: s(40).default(""),
      })
    )
    .max(30)
    .default([]),
  userEditedFields: z.array(s(80)).max(40).default([]),
});

/** Account deletion requires the exact phrase — a fat-fingered POST can't erase a user. */
export const deleteAccountBodySchema = z.object({
  confirm: z.literal("delete my account"),
});

export const copilotBodySchema = z.object({
  provider: providerSchema.optional(),
  profile: profileSchema,
  strategy: strategySchema,
  result: resultSchema.nullable().optional(),
  facts: factsFieldSchema,
  workspace: copilotWorkspaceSchema.optional(),
  memory: memorySchema.optional(),
  launchDate: s(40).optional(),
  action: z.enum([
    "explain-plan",
    "next-steps",
    "improve-posts",
    "rewrite",
    "first-replies",
    "review-feedback",
    "ask",
  ]),
  question: s(8000).optional(),
  targetPlatformId: s(64).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: s(8000),
      })
    )
    .max(12)
    .optional(),
});
