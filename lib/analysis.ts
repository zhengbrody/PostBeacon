import { generateJsonMeta } from "./llm";
import { auditFacts, pickClarifyingQuestions } from "./facts";
import { asString, asStringList } from "./coerce";
import type { FactAudit, PageCorpus } from "./facts";
import type {
  ClarifyingQuestion,
  Fact,
  GenerationMeta,
  ProductProfile,
  Provider,
} from "./types";

/** Bump when the analyze prompt changes (recorded on every output). */
export const ANALYZE_PROMPT_VERSION = "a4";

export interface AnalysisOutcome {
  profile: ProductProfile;
  facts: Fact[];
  questions: ClarifyingQuestion[];
  meta: GenerationMeta;
  /** What enforcement had to fix (evals read this; the route doesn't return it). */
  audit: FactAudit;
}

/**
 * Turn a scraped page into a profile + provenance-checked fact ledger +
 * (at most 3) clarifying questions. Shared by /api/analyze and the golden
 * evals, so evals measure exactly what production runs.
 */
export async function analyzeScrapedPage(
  page: PageCorpus,
  provider?: Provider
): Promise<AnalysisOutcome> {
  const { data, meta } = await generateJsonMeta({
    provider,
    maxTokens: 3000,
    system:
      "You are a sharp product strategist doing a first-pass diagnosis of a product from its landing page. Don't just lift the marketing copy — form a real point of view on what this is, who would actually pay attention, and why. Be concrete and specific, no fluff. Landing pages oversell; translate hype into the plain underlying truth. The diagnosis fields must do different jobs: whatItIs explains the mechanism in plain language; whyCare names the specific failure, cost, or desire that creates urgency; useCase names one trigger moment and the action taken. Do not fill them with generic category truths, and never introduce a capability the page does not support.\n\nProvenance discipline (non-negotiable): for every fact you must decide honestly whether the PAGE STATES IT ('observed' — and you must copy a short verbatim quote as evidence) or whether YOU are concluding it ('inferred'). If the page simply doesn't say, mark it 'unknown' and leave the claim EMPTY — an honest unknown is worth more than a plausible guess. Your evidence quotes are machine-checked against the page text; a quote that isn't really there gets your fact demoted.",
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
  "confidenceNote": string,  // one line on what you had to infer (empty string if confidence is high)
  "facts": [                 // the provenance ledger — one entry per field below
    { "field": string, "claim": string, "status": "observed"|"inferred"|"unknown",
      "evidence": string,    // REQUIRED for observed: a verbatim quote (5-25 words) copied from the page
      "confidence": number } // 0-1
  ]
}

Fact entries to produce, in this order:
- "name", "tagline", "valueProp", "audience", "category" — the same conclusions as the top-level fields, each honestly tagged observed (with quote) or inferred.
- "stage" — where the product is in its life (pre-launch / just launched / growing). Pages rarely state this: if it doesn't, status "unknown" with an EMPTY claim.
- "conversionGoal" — the conversion the site is clearly built to drive (e.g. "join waitlist", "start free trial"). Only 'observed' if a CTA on the page states it; otherwise unknown with empty claim.
- "assets" — existing audience/assets (e.g. "10,000 developers use it" on the page). Only if the page states something; otherwise unknown with empty claim.
- Up to 3 extra notable claims worth remembering (pricing, hard numbers, integrations, platform support) — each tagged honestly.`,
  });

  const { facts, audit } = auditFacts(data?.facts, page);
  const questions = pickClarifyingQuestions(facts);

  const s = asString;
  const arr = asStringList;

  const profile: ProductProfile = {
    name: s(data?.name),
    tagline: s(data?.tagline),
    valueProp: s(data?.valueProp),
    audience: s(data?.audience),
    differentiators: arr(data?.differentiators),
    features: arr(data?.features),
    tone: s(data?.tone),
    category: s(data?.category),
    whatItIs: s(data?.whatItIs) || undefined,
    whyCare: s(data?.whyCare) || undefined,
    useCase: s(data?.useCase) || undefined,
    confidence: ["high", "medium", "low"].includes(s(data?.confidence))
      ? (s(data?.confidence) as ProductProfile["confidence"])
      : undefined,
    confidenceNote: s(data?.confidenceNote) || undefined,
    // A landing page cannot tell us the human publisher's biography. Stay in
    // brand voice until the operator explicitly opts into founder voice.
    publisherVoice: "brand",
  };

  // Launch context enters the profile ONLY from a verified page observation —
  // never from a model guess. Questions (→ user answers) are the other path.
  for (const field of ["stage", "conversionGoal", "assets"] as const) {
    const f = facts.find((x) => x.field === field);
    if (f?.status === "observed" && f.claim) profile[field] = f.claim;
  }

  return {
    profile,
    facts,
    questions,
    audit,
    meta: {
      provider: meta.provider,
      model: meta.model,
      ...(meta.fallbackFrom ? { fallbackFrom: meta.fallbackFrom } : {}),
      promptVersion: ANALYZE_PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
    },
  };
}
