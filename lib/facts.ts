import type { ClarifyingQuestion, Fact, FactStatus, ProductProfile } from "./types";

/**
 * The Fact Ledger engine. The trust rules live in CODE, not in prompt hope:
 *
 * - "observed" survives only when the model's evidence quote actually appears
 *   in the page text the server scraped (verifyFacts). A fabricated quote
 *   demotes the fact to "inferred" and caps its confidence.
 * - "user-confirmed" can only be produced by the user-action helpers below;
 *   a model emitting it is demoted to "inferred".
 * - "unknown" means the source doesn't say — any claim the model attached to
 *   an unknown is discarded rather than kept as a plausible-looking guess.
 */

export const MAX_FACTS = 14;

/** Launch-context fields the page almost never states — the question targets. */
export const CONTEXT_FIELDS = ["stage", "conversionGoal", "assets"] as const;
export type ContextField = (typeof CONTEXT_FIELDS)[number];

/** Confidence below which an inferred key fact still deserves a question. */
const ASK_THRESHOLD = 0.7;

/** Normalize for quote-in-page matching: case, whitespace, curly punctuation. */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PageCorpus {
  url: string;
  title: string;
  description: string;
  headings: string[];
  text: string;
}

/** True if `quote` appears verbatim (modulo case/whitespace) in the page. */
export function quoteAppearsOnPage(quote: string, page: PageCorpus): boolean {
  const q = normalizeForMatch(quote);
  if (q.length < 8) return false; // too short to be meaningful evidence
  const corpus = normalizeForMatch(
    [page.title, page.description, page.headings.join(" "), page.text].join(" ")
  );
  return corpus.includes(q);
}

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const clamp01 = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
};

/** What enforcement had to fix — the honesty signal the evals track. */
export interface FactAudit {
  proposedObserved: number; // facts the model claimed were observed
  demotedObserved: number; // …whose evidence quote did NOT verify (fabricated)
  proposedUserConfirmed: number; // never the model's call — always demoted
  unknownWithClaim: number; // guesses attached to unknowns (claim discarded)
}

/**
 * Turn raw model "facts" into the enforced ledger. This is the choke point
 * where a model cannot pass inference off as observation.
 */
export function verifyFacts(rawFacts: unknown, page: PageCorpus): Fact[] {
  return auditFacts(rawFacts, page).facts;
}

/** verifyFacts plus the enforcement audit (used by the golden evals). */
export function auditFacts(
  rawFacts: unknown,
  page: PageCorpus
): { facts: Fact[]; audit: FactAudit } {
  const audit: FactAudit = {
    proposedObserved: 0,
    demotedObserved: 0,
    proposedUserConfirmed: 0,
    unknownWithClaim: 0,
  };
  const now = new Date().toISOString();
  const list = Array.isArray(rawFacts) ? rawFacts : [];
  const seen = new Set<string>();
  const out: Fact[] = [];

  for (const raw of list) {
    if (out.length >= MAX_FACTS) break;
    const r = (raw ?? {}) as Record<string, unknown>;
    const field = str(r.field, 40) || undefined;
    let claim = str(r.claim, 500);
    const evidence = str(r.evidence, 300);
    const proposed = str(r.status, 20) as FactStatus | string;
    let confidence = clamp01(r.confidence);

    let status: FactStatus;
    let keptEvidence: string | undefined;
    let sourceUrl: string | undefined;

    if (proposed === "observed") audit.proposedObserved++;
    if (proposed === "user-confirmed") audit.proposedUserConfirmed++;

    if (proposed === "unknown" || !claim) {
      // The source doesn't say. Discard any guess the model attached so an
      // unknown never carries a plausible-looking claim.
      if (proposed === "unknown" && claim) audit.unknownWithClaim++;
      status = "unknown";
      claim = "";
      confidence = 0;
    } else if (proposed === "observed" && quoteAppearsOnPage(evidence, page)) {
      status = "observed";
      keptEvidence = evidence;
      sourceUrl = page.url;
      confidence = Math.max(confidence, 0.8);
    } else {
      // Covers: model said observed but the quote doesn't verify (the lie we
      // exist to catch), model said inferred, model said user-confirmed
      // (never its call to make), or any unrecognized status.
      if (proposed === "observed") audit.demotedObserved++;
      status = "inferred";
      confidence = Math.min(confidence, 0.6);
    }

    const id = field && !seen.has(field) ? field : `fact-${out.length + 1}`;
    seen.add(id);
    out.push({
      id,
      field,
      claim,
      evidence: keptEvidence,
      sourceUrl,
      sourceType: status === "observed" ? "page" : "model",
      status,
      confidence,
      lastVerifiedAt: now,
    });
  }

  // The question picker needs the three context facts to exist even when the
  // model omitted them — synthesize honest unknowns.
  for (const field of CONTEXT_FIELDS) {
    if (out.length >= MAX_FACTS) break;
    if (!out.some((f) => f.field === field)) {
      out.push({
        id: field,
        field,
        claim: "",
        sourceType: "model",
        status: "unknown",
        confidence: 0,
        lastVerifiedAt: now,
      });
    }
  }
  return { facts: out, audit };
}

// ---------------------------------------------------------------------------
// Clarifying questions — at most 3, picked by code from a fixed high-value set.

const QUESTION_DEFS: Record<ContextField, Omit<ClarifyingQuestion, "id">> = {
  stage: {
    question: "Where is the product right now?",
    why: "A pre-launch plan opens completely differently from a growth push — this sets the sequencing.",
    options: [
      "Pre-launch — no users yet",
      "Just launched — first users trickling in",
      "Growing — steady signups",
      "Established — revenue, looking for a new channel",
    ],
  },
  conversionGoal: {
    question: "What's the one conversion that matters most right now?",
    why: "Every post's call-to-action and the calendar's aim point at this.",
    options: [
      "Waitlist signups",
      "Free signups / installs",
      "Paying customers",
      "GitHub stars / community",
    ],
  },
  assets: {
    question: "What do you already have to launch with?",
    why: "Channels get re-weighted around audiences you already own (a list, followers, communities you're active in) and real constraints (budget, hours).",
  },
};

/** Ask only about context facts that are unknown or weakly inferred. */
export function pickClarifyingQuestions(facts: Fact[]): ClarifyingQuestion[] {
  const out: ClarifyingQuestion[] = [];
  for (const field of CONTEXT_FIELDS) {
    const f = facts.find((x) => x.field === field);
    const needsAsk =
      !f ||
      f.status === "unknown" ||
      (f.status === "inferred" && f.confidence < ASK_THRESHOLD);
    if (needsAsk) out.push({ id: field, ...QUESTION_DEFS[field] });
  }
  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------
// User operations — the ONLY producers of "user-confirmed".

export function confirmFact(f: Fact): Fact {
  return { ...f, status: "user-confirmed", confidence: 1, lastVerifiedAt: new Date().toISOString() };
}

export function correctFact(f: Fact, claim: string): Fact {
  return {
    ...f,
    claim: claim.trim().slice(0, 500),
    // A user-edited claim is the user's assertion — page evidence no longer backs it.
    evidence: undefined,
    sourceUrl: undefined,
    sourceType: "user",
    status: "user-confirmed",
    confidence: 1,
    lastVerifiedAt: new Date().toISOString(),
  };
}

/** A clarifying-question answer as a ledger fact. */
export function answerFact(field: ContextField, answer: string): Fact {
  return {
    id: field,
    field,
    claim: answer.trim().slice(0, 500),
    sourceType: "user",
    status: "user-confirmed",
    confidence: 1,
    lastVerifiedAt: new Date().toISOString(),
  };
}

/** Sync a fact's claim into the profile field it backs (when it maps 1:1). */
export function applyFactToProfile(profile: ProductProfile, fact: Fact): ProductProfile {
  const f = fact.field;
  if (!f || !fact.claim) return profile;
  const direct: (keyof ProductProfile)[] = [
    "name",
    "tagline",
    "valueProp",
    "audience",
    "category",
    "stage",
    "conversionGoal",
    "assets",
  ];
  if (!direct.includes(f as keyof ProductProfile)) return profile;
  return { ...profile, [f]: fact.claim };
}

// ---------------------------------------------------------------------------
// Prompt block — how downstream calls see the ledger.

export function factsForPrompt(facts: Fact[]): string {
  if (!facts.length) return "";
  const line = (f: Fact) => `- [${f.id}] ${f.field ? `${f.field}: ` : ""}${f.claim}`;
  const established = facts.filter(
    (f) => f.status === "observed" || f.status === "user-confirmed"
  );
  const inferred = facts.filter((f) => f.status === "inferred" && f.claim);
  const unknown = facts.filter((f) => f.status === "unknown");

  const out: string[] = ["FACT LEDGER (provenance-checked):"];
  if (established.length) {
    out.push(
      "ESTABLISHED (verified on the page or confirmed by the founder — safe to state as true):",
      ...established.map(line)
    );
  }
  if (inferred.length) {
    out.push(
      "INFERRED (unverified guesses — hedge if used; never present as established fact):",
      ...inferred.map(line)
    );
  }
  if (unknown.length) {
    out.push(
      "UNKNOWN (the founder hasn't said — do NOT assume; write around it or use [fill in] placeholders):",
      ...unknown.map((f) => `- ${f.field || f.id}`)
    );
  }
  return out.join("\n");
}
