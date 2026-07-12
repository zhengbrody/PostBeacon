import { PLATFORMS, type PlatformDef } from "./platforms";
import { factsForPrompt } from "./facts";
import { asRecord, asRecordList, clipString } from "./coerce";
import type {
  DiscoveredChannel,
  Fact,
  PlatformRecommendation,
  Priority,
  ProductProfile,
  ScoreBreakdown,
  ScoreDimension,
} from "./types";

/**
 * Explainable platform scoring. The model rates DIMENSIONS with reasons and
 * fact references; everything that ranks — the 0-100 total, the priority, the
 * effort cost, the evidence quality — is computed deterministically here.
 * The same file owns the repair pipeline that guarantees the API always
 * returns exactly one recommendation per catalog platform.
 */

/** Bump when the scoring prompt changes (recorded on strategy meta). */
export const SCORING_PROMPT_VERSION = "s2";

/** Dimensions the model rates (everything else is code-derived). */
export const MODEL_DIMS = [
  "audienceFit",
  "intentFit",
  "nativeContentFit",
  "founderAccess",
  "risk",
] as const;
export type ModelDim = (typeof MODEL_DIMS)[number];

export const SCORE_WEIGHTS: Record<keyof ScoreBreakdown, number> = {
  audienceFit: 0.28,
  intentFit: 0.24,
  nativeContentFit: 0.18,
  founderAccess: 0.1,
  effort: 0.08,
  risk: 0.07,
  evidenceQuality: 0.05,
};

/** Catalog effort → cost points (inverted into the total: low effort scores high). */
export const EFFORT_COST: Record<PlatformDef["effort"], number> = {
  low: 2,
  medium: 5,
  high: 8,
};

/** Dimensions where a HIGH raw score means a WORSE outcome (inverted in the total). */
const INVERTED: ReadonlySet<keyof ScoreBreakdown> = new Set(["effort", "risk"]);

const clamp10 = (v: unknown): number | null => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // Tolerate rounding slop just past the ends, but a value like 85 means the
  // model rated on a 0-100 scale — clamping that to 10 would silently inflate
  // the dimension to a perfect score, so it invalidates the entry instead.
  if (n < -0.5 || n > 11) return null;
  return Math.min(10, Math.max(0, Math.round(n * 10) / 10));
};

/** The deterministic 0-100 total. The model never sets this. */
export function computeTotal(b: ScoreBreakdown): number {
  let total = 0;
  for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
    const dim = b[key as keyof ScoreBreakdown];
    const value = INVERTED.has(key as keyof ScoreBreakdown) ? 10 - dim.score : dim.score;
    total += weight * value * 10;
  }
  return Math.round(Math.min(100, Math.max(0, total)));
}

export function derivePriority(total: number): Priority {
  if (total >= 70) return "high";
  if (total >= 45) return "medium";
  return "low";
}

/**
 * Evidence quality is earned, not claimed: each model-rated dimension gets
 * full credit (2) when it cites an observed/user-confirmed fact, half (1)
 * for citing only inferred facts, none otherwise. Max 10.
 */
export function computeEvidenceQuality(
  dims: Record<ModelDim, ScoreDimension>,
  facts: Fact[]
): ScoreDimension {
  const byId = new Map(facts.map((f) => [f.id, f]));
  let credit = 0;
  let grounded = 0;
  for (const key of MODEL_DIMS) {
    const cited = (dims[key].factIds ?? [])
      .map((id) => byId.get(id))
      .filter((f): f is Fact => !!f && !!f.claim);
    if (cited.some((f) => f.status === "observed" || f.status === "user-confirmed")) {
      credit += 2;
      grounded++;
    } else if (cited.some((f) => f.status === "inferred")) {
      credit += 1;
    }
  }
  return {
    score: Math.min(10, credit),
    reason: `${grounded}/${MODEL_DIMS.length} dimensions cite verified facts (computed, not model-claimed).`,
  };
}

const str = clipString;

/** Parse one raw model dimension; null when unusable (treated as missing). */
function parseDim(raw: unknown, facts: Fact[]): ScoreDimension | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const score = clamp10(r.score);
  if (score === null) return null;
  const knownIds = new Set(facts.map((f) => f.id));
  const factIds = Array.isArray(r.factIds)
    ? r.factIds
        .map((id) => String(id))
        .filter((id) => knownIds.has(id))
        .slice(0, 6)
    : undefined;
  const dim: ScoreDimension = { score, reason: str(r.reason, 500) };
  const evidence = str(r.evidence, 300);
  if (evidence) dim.evidence = evidence;
  if (factIds?.length) dim.factIds = factIds;
  return dim;
}

/**
 * Turn one raw model entry into a full recommendation, or null when the
 * entry is structurally unusable (→ the repair loop treats it as missing).
 */
export function toRecommendation(
  raw: unknown,
  platform: PlatformDef,
  facts: Fact[]
): PlatformRecommendation | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawDims = (r.dimensions ?? {}) as Record<string, unknown>;

  const dims = {} as Record<ModelDim, ScoreDimension>;
  for (const key of MODEL_DIMS) {
    const dim = parseDim(rawDims[key], facts);
    if (!dim) return null; // a missing/invalid dimension invalidates the entry
    dims[key] = dim;
  }

  const breakdown: ScoreBreakdown = {
    ...dims,
    effort: {
      score: EFFORT_COST[platform.effort],
      reason: `Catalog: doing ${platform.name} well is ${platform.effort} effort (fixed, not model-rated).`,
    },
    evidenceQuality: computeEvidenceQuality(dims, facts),
  };

  const score = computeTotal(breakdown);
  const confidence = str(r.confidence, 10);
  const rec: PlatformRecommendation = {
    platformId: platform.id,
    platformName: platform.name,
    score,
    priority: derivePriority(score),
    effort: platform.effort,
    rationale: str(r.rationale, 4000),
    angle: str(r.angle, 4000),
    breakdown,
    provenance: "inferred", // grounding may upgrade this later — never the model
  };
  if (["high", "medium", "low"].includes(confidence)) {
    rec.confidence = confidence as PlatformRecommendation["confidence"];
  }
  const bestMove = str(r.bestMove, 4000);
  if (bestMove) rec.bestMove = bestMove;
  const venue = str(r.venue, 200);
  if (venue) rec.venue = venue;
  return rec;
}

/** Deterministic placeholder when the model never produced a usable rating. */
export function fallbackRecommendation(
  platform: PlatformDef,
  facts: Fact[]
): PlatformRecommendation {
  const neutral = (reason: string): ScoreDimension => ({ score: 4, reason });
  const note = "Not assessed — the model didn't return a usable rating for this channel.";
  const dims: Record<ModelDim, ScoreDimension> = {
    audienceFit: neutral(note),
    intentFit: neutral(note),
    nativeContentFit: neutral(note),
    founderAccess: neutral(note),
    risk: { score: 5, reason: note },
  };
  const breakdown: ScoreBreakdown = {
    ...dims,
    effort: {
      score: EFFORT_COST[platform.effort],
      reason: `Catalog: doing ${platform.name} well is ${platform.effort} effort (fixed, not model-rated).`,
    },
    evidenceQuality: computeEvidenceQuality(dims, facts),
  };
  const score = computeTotal(breakdown);
  return {
    platformId: platform.id,
    platformName: platform.name,
    score,
    priority: derivePriority(score),
    effort: platform.effort,
    rationale:
      "Automatic placeholder: the strategist didn't return a usable rating for this channel, even after a retry. Regenerate the strategy to score it properly.",
    angle: "",
    breakdown,
    provenance: "inferred",
    fallback: true,
  };
}

// ---------------------------------------------------------------------------
// Prompt + repair pipeline

function catalogFor(platforms: PlatformDef[]) {
  return platforms.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    reaches: p.reaches,
  }));
}

export function scoringPrompt(
  profile: ProductProfile,
  facts: Fact[],
  platforms: PlatformDef[]
): { system: string; user: string; maxTokens: number } {
  return {
    system:
      "You are a channel strategist rating launch channels for one specific product. You do NOT produce an overall score — the ranking is computed from your dimension ratings, so rate each dimension honestly and independently instead of steering a favorite. Ground reasons in the fact ledger: cite factIds when a rating leans on a fact, and when the ledger marks something unknown, do not assume it. Reasons must be specific to THIS product — if a reason would fit a different product unchanged, sharpen it.",
    user: `PRODUCT PROFILE:
${JSON.stringify(profile, null, 2)}

${factsForPrompt(facts)}

CHANNELS TO RATE (every single one, exactly once):
${JSON.stringify(catalogFor(platforms), null, 2)}

For EACH channel return dimension ratings 0-10 with a short reason (max 15 words each):
- audienceFit: is this product's buyer actually present here?
- intentFit: are they here in a mindset/moment this product can catch?
- nativeContentFit: can this product yield content natives of the channel genuinely upvote?
- founderAccess: can a solo founder credibly show up here without an existing reputation?
- risk: 10 = most likely to get flagged, buried, or banned if it smells promotional.

Also per channel: "rationale" (2 sentences, why/why not), "angle" (the marketing angle to use), "bestMove" (the single highest-leverage action, naming the exact venue), "venue" (that venue's exact name, e.g. "r/selfhosted"), "confidence" high|medium|low.

Return JSON exactly:
{ "recommendations": [ { "platformId": string,
    "dimensions": {
      "audienceFit": { "score": number, "reason": string, "factIds": string[] },
      "intentFit": { "score": number, "reason": string, "factIds": string[] },
      "nativeContentFit": { "score": number, "reason": string, "factIds": string[] },
      "founderAccess": { "score": number, "reason": string, "factIds": string[] },
      "risk": { "score": number, "reason": string, "factIds": string[] }
    },
    "confidence": "high"|"medium"|"low",
    "rationale": string, "angle": string, "bestMove": string, "venue": string } ] }

Rules:
- Exactly ${platforms.length} entries — one per channel id listed, no duplicates, no extras.
- factIds: cite ledger ids (e.g. ["audience"]) when a rating leans on that fact; empty array when it doesn't.
- Be honest with low scores. A flat 7-everywhere sheet is useless.`,
    maxTokens: 6000,
  };
}

/** Model-call seam: the pipeline works through this, so tests inject fakes. */
export type ScoreCall = (prompt: {
  system: string;
  user: string;
  maxTokens: number;
}) => Promise<unknown>;

export interface ScoringDiagnostics {
  firstPassValid: number;
  duplicates: number;
  invalid: number;
  retried: string[]; // ids missing after the first pass (retry attempted)
  recovered: string[]; // ids the retry fixed
  fallbacks: string[]; // ids that ended as deterministic placeholders
}

/**
 * The completeness guarantee: returns exactly one recommendation per catalog
 * platform (unique, schema-valid), via first pass → one scoped retry for the
 * missing/invalid ids → deterministic fallbacks for whatever remains.
 */
export async function scoreAllPlatforms(
  profile: ProductProfile,
  facts: Fact[],
  callModel: ScoreCall,
  platforms: PlatformDef[] = PLATFORMS
): Promise<{ recommendations: PlatformRecommendation[]; diagnostics: ScoringDiagnostics }> {
  const byId = new Map(platforms.map((p) => [p.id, p]));
  const valid = new Map<string, PlatformRecommendation>();
  const diagnostics: ScoringDiagnostics = {
    firstPassValid: 0,
    duplicates: 0,
    invalid: 0,
    retried: [],
    recovered: [],
    fallbacks: [],
  };

  const ingest = (raw: unknown, phase: "first" | "retry") => {
    const list = asRecordList(asRecord(raw).recommendations);
    for (const entry of list) {
      const id = String(entry.platformId ?? "");
      const platform = byId.get(id);
      if (!platform) continue; // unknown id — never invent platforms
      if (valid.has(id)) {
        if (phase === "first") diagnostics.duplicates++;
        continue; // dedupe: first valid entry wins
      }
      const rec = toRecommendation(entry, platform, facts);
      if (!rec) {
        if (phase === "first") diagnostics.invalid++;
        continue;
      }
      valid.set(id, rec);
      if (phase === "retry") diagnostics.recovered.push(id);
    }
  };

  try {
    ingest(await callModel(scoringPrompt(profile, facts, platforms)), "first");
  } catch {
    // First pass failed wholesale (timeout/parse) — the retry below still runs.
  }
  diagnostics.firstPassValid = valid.size;

  let missing = platforms.filter((p) => !valid.has(p.id));
  if (missing.length) {
    diagnostics.retried = missing.map((p) => p.id);
    try {
      ingest(await callModel(scoringPrompt(profile, facts, missing)), "retry");
    } catch {
      // fall through to fallbacks
    }
    missing = platforms.filter((p) => !valid.has(p.id));
  }

  for (const p of missing) {
    valid.set(p.id, fallbackRecommendation(p, facts));
    diagnostics.fallbacks.push(p.id);
  }

  const recommendations = platforms
    .map((p) => valid.get(p.id)!)
    .sort((a, b) => b.score - a.score);
  return { recommendations, diagnostics };
}

// ---------------------------------------------------------------------------
// Source grounding — "grounded" is earned via validated discoveries, post-hoc.

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Attach sources to recommendations whose venue/bestMove names a channel the
 * live discovery pass actually validated. URLs only ever come from validated
 * discoveries — a model-written URL is never trusted. Everything unmatched
 * stays provenance "inferred" (the UI must not show it as verified).
 */
export function groundRecommendations(
  recs: PlatformRecommendation[],
  discoveries: DiscoveredChannel[] | undefined
): PlatformRecommendation[] {
  const validated = (discoveries ?? []).filter((d) => d.validated && d.url && d.name);
  if (!validated.length) return recs;
  return recs.map((rec) => {
    const haystack = norm(`${rec.venue ?? ""} ${rec.bestMove ?? ""}`);
    if (!haystack.trim()) return rec;
    const sources = validated
      .filter((d) => {
        const name = norm(d.name);
        return name.length >= 3 && haystack.includes(name);
      })
      .map((d) => d.url)
      .slice(0, 3);
    return sources.length ? { ...rec, sources, provenance: "grounded" as const } : rec;
  });
}
