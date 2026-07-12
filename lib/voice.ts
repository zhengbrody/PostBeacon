/**
 * The house rules for making generated content read like a real person wrote it,
 * not an LLM. Injected into every content-generation system prompt. The single
 * most important lever for the product's credibility — a post that smells like AI
 * gets ignored or flagged on exactly the platforms we target.
 */

/**
 * Machine-checkable banned phrases (lowercase). Single source of truth: the
 * prompt below is built from this list, and the golden-eval linter checks
 * generated content against the same list — the prompt and the test can't drift.
 */
export const BANNED_PHRASES: string[] = [
  "in today's fast-paced world",
  "in an era of",
  "in the world of",
  "let's dive in",
  "let's face it",
  "game-changer",
  "game changing",
  "revolutionary",
  "seamless",
  "seamlessly",
  "unlock",
  "unleash",
  "elevate",
  "supercharge",
  "leverage",
  "robust",
  "cutting-edge",
  "powerful",
  "effortless",
  "next-level",
  "10x",
  "boast",
  "excited to announce",
  "thrilled to share",
  "i'm proud to",
  "say goodbye to",
  "look no further",
  "streamline",
  "empower",
  "delve",
];

/** Regexes for tells that aren't a fixed phrase. */
const BANNED_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'opener "Introducing"', re: /^\s*introducing\b/i },
  { name: '"Whether you\'re X or Y"', re: /\bwhether you'?re\b[^.\n]{3,60}\bor\b/i },
  { name: '"It\'s not just X — it\'s Y"', re: /\b(?:it'?s|this is) not just\b[^.\n]{3,80}\b(?:it'?s|but)\b/i },
  { name: '"not only … but also"', re: /\bnot only\b[^.\n]{3,80}\bbut also\b/i },
  { name: '"That\'s where X comes in"', re: /\bthat'?s where\b[^.\n]{2,60}\bcomes in\b/i },
];

export interface VoiceViolation {
  phrase: string; // the banned phrase / pattern name
  excerpt: string; // where it appeared (trimmed context)
}

/**
 * Lint a piece of generated content against the banned list. Used by the
 * golden evals; deliberately simple (case-insensitive substring / regex) so a
 * violation is unambiguous.
 */
export function lintVoice(text: string): VoiceViolation[] {
  const out: VoiceViolation[] = [];
  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    const i = lower.indexOf(phrase);
    if (i !== -1) {
      out.push({ phrase, excerpt: text.slice(Math.max(0, i - 20), i + phrase.length + 20).trim() });
    }
  }
  for (const { name, re } of BANNED_PATTERNS) {
    const m = text.match(re);
    if (m) out.push({ phrase: name, excerpt: m[0].slice(0, 60) });
  }
  return out;
}

const bannedList = BANNED_PHRASES.map((p) => `"${p}"`).join(", ");

export const ANTI_AI_RULES = `WRITE LIKE A REAL FOUNDER, NOT A MARKETING BOT. These rules are non-negotiable:

Banned words & phrases (never use, in any form): ${bannedList} — and never open a piece with "Introducing".

Banned rhythms:
- No "Whether you're X or Y", "It's not just X — it's Y", "not only… but also", "That's where <product> comes in".
- No three-item triads for cadence ("faster, cleaner, smarter").
- No em-dash-into-summary tic. No rhetorical question as the opener unless that's genuinely how people talk on this platform.
- Don't end on a tidy inspirational summary line. Stop when the point is made.

Do this instead:
- Open with a concrete situation, a real result, a friction, or a plain flat claim — NOT the product name or a definition.
- Prefer specifics over adjectives: the actual annoying thing, a real number, the real workflow. If you don't have a fact, describe a concrete scenario rather than praising.
- Vary sentence length. Let some be short. A fragment is fine.
- First person, slightly understated, willing to admit a limitation. You're a maker sharing something, not a brand.
- Emoji: at most one, and only where natives of THIS platform actually use them (zero on Hacker News, Lobsters, blogs, Stack Overflow). No hashtag stuffing.

Internal check (never reveal, never reference in output): before finalizing each piece, silently ask "would a skeptical regular of this platform smell marketing here?" If yes, rewrite it plainer and more specific. Output only the finished content.`;
