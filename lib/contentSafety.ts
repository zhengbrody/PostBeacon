import { PLATFORMS } from "./platforms";
import type { Fact, PlatformPost, ProductProfile } from "./types";

export type DraftSafetyCode =
  | "placeholder"
  | "brand-impersonation"
  | "invented-anecdote"
  | "invented-identity"
  | "invented-testimonial"
  | "unsupported-limitation"
  | "unsupported-metric"
  | "regulated-outcome"
  | "over-limit";

export interface DraftSafetyIssue {
  code: DraftSafetyCode;
  title: string;
  excerpt: string;
  fix: string;
}

export interface DraftSafetyReport {
  ready: boolean;
  issues: DraftSafetyIssue[];
}

const PLACEHOLDER =
  /(?:\[[^\]]*(?:fill|insert|add|your|link|url|metric|number|name)[^\]]*\]|<(?:fill|insert|your|link|url)[^>]*>|\b(?:TBD|TODO)\b)/i;
const FIRST_PERSON = /\b(?:i|me|my|mine)\b/i;
const ANECDOTE =
  /\b(?:i once|i used to|i remember|i heard|i learned the hard way|when i (?:started|invested|lost|tried)|my (?:portfolio|investment|experience))\b/i;
const IDENTITY =
  /\b(?:i am|i'm|as)\s+(?:an?\s+)?(?:financial analyst|adviser|advisor|investor|engineer|developer|marketer|designer|researcher|expert)\b/i;
const TESTIMONIAL =
  /\b(?:(?:a|one|our)\s+(?:user|customer|investor|founder|client)|people)\s+(?:said|told|asked|wrote)\b/i;
const LIMITATION =
  /\b(?:we|i|it|the product|this product)\s+(?:can(?:not|'t)(?:\s+yet)?|does(?:\s+not|n't)(?:\s+yet)?|is(?:\s+not|n't)(?:\s+yet)?|only supports?|currently supports? only)\b/i;
// Digits with separators, magnitude suffixes (10k, 1M), optional $/%/+, and an
// optional "of" link — the abbreviation styles models actually use for
// invented traction ("10k users", "$50k in revenue", "40% of teams").
const UNSUPPORTED_METRIC =
  /(?:\$\s*)?\b\d[\d,.]*\s*(?:[kmb]\b)?\+?\s*%?\s*(?:of\s+|in\s+)?(?:users?|customers?|signups?|downloads?|installs?|revenue|mrr|arr|hours? saved|countries|teams?)\b/i;
const REGULATED_PROMISE =
  /\b(?:guarantee(?:d|s)?|ensure(?:s|d)?|avoid(?:ing)? losses|prevent(?:s|ing)? losses|sidestep(?:s|ping)? (?:a )?(?:fall|drop|loss)|beat(?:s|ing)? the market|get rich|predict(?:s|ing)? (?:the )?market|protect(?:s|ing)?[^.\n]{0,35}(?:loss|drop|fall))\b/i;

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "but",
  "can",
  "currently",
  "does",
  "for",
  "from",
  "have",
  "into",
  "not",
  "only",
  "our",
  "product",
  "supports",
  "that",
  "the",
  "their",
  "this",
  "with",
  "yet",
  "you",
  "your",
]);

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function sentenceFor(text: string, match: RegExp): string {
  const pieces = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const hit = pieces.find((piece) => match.test(piece)) ?? text.match(match)?.[0] ?? text;
  return hit.length > 180 ? `${hit.slice(0, 177)}…` : hit;
}

function profileText(profile: ProductProfile): string[] {
  return [
    profile.name,
    profile.tagline,
    profile.valueProp,
    profile.audience,
    profile.category,
    profile.whatItIs ?? "",
    profile.whyCare ?? "",
    profile.useCase ?? "",
    ...profile.features,
    ...profile.differentiators,
  ].filter(Boolean);
}

function supportCorpus(facts: Fact[]): string[] {
  return facts
    .filter((fact) => fact.status === "observed" || fact.status === "user-confirmed")
    .flatMap((fact) => [fact.claim, fact.evidence ?? ""]);
}

function isSupported(excerpt: string, corpus: string[]): boolean {
  const wanted = new Set(words(excerpt));
  if (wanted.size < 2) return false;
  return corpus.some((source) => {
    const available = new Set(words(source));
    const overlap = [...wanted].filter((word) => available.has(word)).length;
    return overlap >= Math.min(3, wanted.size) && overlap / wanted.size >= 0.55;
  });
}

function isRegulatedProduct(profile: ProductProfile): boolean {
  return /\b(?:financ|invest|portfolio|trading|medical|health|legal|insurance|credit)\b/i.test(
    profileText(profile).join(" ")
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function limitationMatcher(profile: ProductProfile): RegExp {
  const productName = profile.name.trim();
  if (!productName) return LIMITATION;
  return new RegExp(
    `\\b(?:we|i|it|the product|this product|${escapeRegex(productName)})\\s+(?:can(?:not|'t)(?:\\s+yet)?|does(?:\\s+not|n't)(?:\\s+yet)?|is(?:\\s+not|n't)(?:\\s+yet)?|only supports?|currently supports? only)\\b`,
    "i"
  );
}

function issue(
  code: DraftSafetyCode,
  title: string,
  excerpt: string,
  fix: string
): DraftSafetyIssue {
  return { code, title, excerpt, fix };
}

export interface CharBudget {
  limit: number;
  /** hook + blank line + body — exactly what Copy puts on the clipboard. */
  total: number;
  /** Longest single segment (hook or a blank-line-separated body block). */
  longestSegment: number;
  /** The whole draft fits one post. */
  fitsSingle: boolean;
  /** Every segment fits, so it can be published as a thread even if total > limit. */
  fitsThread: boolean;
}

/**
 * Character budget against a platform's hard per-post limit. A draft whose
 * blank-line segments each fit is still EXECUTABLE (as a thread), so only a
 * segment that can never be posted is a safety failure; the single-vs-thread
 * distinction is surfaced in the workbench counter.
 */
export function charBudget(
  post: Pick<PlatformPost, "hook" | "body">,
  limit: number
): CharBudget {
  const total = `${post.hook}\n\n${post.body}`.trim().length;
  const segments = [post.hook, ...post.body.split(/\n{2,}/)]
    .map((segment) => segment.trim())
    .filter(Boolean);
  const longestSegment = segments.reduce(
    (max, segment) => Math.max(max, segment.length),
    0
  );
  return {
    limit,
    total,
    longestSegment,
    fitsSingle: total <= limit,
    fitsThread: longestSegment <= limit,
  };
}

/** The platform's hard character cap, if it has one (lib/platforms catalog). */
export function platformCharLimit(platformId?: string): number | undefined {
  if (!platformId) return undefined;
  return PLATFORMS.find((platform) => platform.id === platformId)?.charLimit;
}

/**
 * A deterministic last-mile gate for generated drafts. It deliberately checks
 * only high-confidence failure classes; it is not a vague AI "quality score".
 * A user can clear every issue by editing the exact nearby text or confirming
 * the missing fact in the ledger and regenerating.
 */
export function auditDraftSafety(
  post: Pick<PlatformPost, "hook" | "body">,
  facts: Fact[],
  profile: ProductProfile,
  platformId?: string
): DraftSafetyReport {
  const text = `${post.hook}\n${post.body}`.trim();
  const corpus = supportCorpus(facts);
  const issues: DraftSafetyIssue[] = [];
  const add = (next: DraftSafetyIssue) => {
    if (!issues.some((current) => current.code === next.code)) issues.push(next);
  };

  // Executability is part of truth: a segment no post on this platform can
  // ever hold makes the draft impossible to publish as written.
  const limit = platformCharLimit(platformId);
  if (limit) {
    const budget = charBudget(post, limit);
    if (!budget.fitsThread) {
      add(
        issue(
          "over-limit",
          `Too long to post on this platform`,
          `Longest segment is ${budget.longestSegment} of ${limit} characters.`,
          `Shorten it, or split the body into blank-line thread segments of ≤${limit} characters each.`
        )
      );
    }
  }

  if (PLACEHOLDER.test(text)) {
    add(
      issue(
        "placeholder",
        "Unresolved placeholder",
        sentenceFor(text, PLACEHOLDER),
        "Replace it with the real value or remove the sentence."
      )
    );
  }

  if ((profile.publisherVoice ?? "brand") === "brand" && FIRST_PERSON.test(text)) {
    add(
      issue(
        "brand-impersonation",
        "Brand voice is impersonating a person",
        sentenceFor(text, FIRST_PERSON),
        "Rewrite in product/team voice, or explicitly switch the project to Founder voice."
      )
    );
  }

  if (ANECDOTE.test(text)) {
    add(
      issue(
        "invented-anecdote",
        "Personal story needs confirmation",
        sentenceFor(text, ANECDOTE),
        "Use a product fact or a concrete user-confirmed story instead."
      )
    );
  }

  if (IDENTITY.test(text)) {
    add(
      issue(
        "invented-identity",
        "Professional identity is unverified",
        sentenceFor(text, IDENTITY),
        "Remove the credential unless the publisher explicitly confirmed it."
      )
    );
  }

  if (TESTIMONIAL.test(text)) {
    add(
      issue(
        "invented-testimonial",
        "Attributed quote is unverified",
        sentenceFor(text, TESTIMONIAL),
        "Use a real, consented quote or describe the problem without attribution."
      )
    );
  }

  const limitation = limitationMatcher(profile);
  if (limitation.test(text)) {
    const excerpt = sentenceFor(text, limitation);
    if (!isSupported(excerpt, corpus)) {
      add(
        issue(
          "unsupported-limitation",
          "Product limitation is not in the verified facts",
          excerpt,
          "Confirm the limitation in the Fact Ledger or remove it."
        )
      );
    }
  }

  if (UNSUPPORTED_METRIC.test(text)) {
    const excerpt = sentenceFor(text, UNSUPPORTED_METRIC);
    if (!isSupported(excerpt, corpus)) {
      add(
        issue(
          "unsupported-metric",
          "Performance or traction number is unsupported",
          excerpt,
          "Use a verified number from the product profile or remove it."
        )
      );
    }
  }

  if (isRegulatedProduct(profile) && REGULATED_PROMISE.test(text)) {
    add(
      issue(
        "regulated-outcome",
        "High-risk outcome promise",
        sentenceFor(text, REGULATED_PROMISE),
        "Describe what the product measures or helps users understand, not an assured outcome."
      )
    );
  }

  return { ready: issues.length === 0, issues };
}

export function unsafeDraftCount(
  posts: Pick<PlatformPost, "hook" | "body">[],
  facts: Fact[],
  profile: ProductProfile,
  platformId?: string
): number {
  return posts.filter((post) => !auditDraftSafety(post, facts, profile, platformId).ready)
    .length;
}
