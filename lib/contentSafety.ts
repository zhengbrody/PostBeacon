import type { Fact, PlatformPost, ProductProfile } from "./types";

export type DraftSafetyCode =
  | "placeholder"
  | "brand-impersonation"
  | "invented-anecdote"
  | "invented-identity"
  | "invented-testimonial"
  | "unsupported-limitation"
  | "unsupported-metric"
  | "regulated-outcome";

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
const UNSUPPORTED_METRIC =
  /\b\d[\d,.]*%?\s*(?:users?|customers?|signups?|downloads?|installs?|revenue|hours? saved|countries|teams?)\b/i;
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

/**
 * A deterministic last-mile gate for generated drafts. It deliberately checks
 * only high-confidence failure classes; it is not a vague AI "quality score".
 * A user can clear every issue by editing the exact nearby text or confirming
 * the missing fact in the ledger and regenerating.
 */
export function auditDraftSafety(
  post: Pick<PlatformPost, "hook" | "body">,
  facts: Fact[],
  profile: ProductProfile
): DraftSafetyReport {
  const text = `${post.hook}\n${post.body}`.trim();
  const corpus = supportCorpus(facts);
  const issues: DraftSafetyIssue[] = [];
  const add = (next: DraftSafetyIssue) => {
    if (!issues.some((current) => current.code === next.code)) issues.push(next);
  };

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
  profile: ProductProfile
): number {
  return posts.filter((post) => !auditDraftSafety(post, facts, profile).ready).length;
}
