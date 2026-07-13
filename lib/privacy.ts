// The single source of truth for PostBeacon's public privacy claims (M17).
// The /privacy, /terms and /subprocessors pages, the model picker's data notes,
// and the provider default ordering all render from THIS file, so the published
// statements can't drift from what the code does. Full inventory + threat model:
// docs/M17-privacy-trust.md. Draft copy — pending legal review, not legal advice.

import type { Provider } from "./types";

/** Bump when the published policy text meaningfully changes. */
export const PRIVACY_LAST_UPDATED = "2026-07-12";

/**
 * How each LLM provider handles API data, per its PUBLIC policy as of
 * PRIVACY_LAST_UPDATED (counsel must re-verify before treating as contractual).
 * `clearPolicy: false` means training use isn't clearly excluded — such a
 * provider is never picked as the code default (see availableProviders) and
 * gets a caution note beside the model picker.
 */
export interface ProviderPrivacy {
  label: string;
  region: string;
  policyUrl: string;
  /** True when the provider clearly states API data is not used for training. */
  clearPolicy: boolean;
  /** One line rendered beside the model picker. */
  note: string;
}

export const PROVIDER_PRIVACY: Record<Provider, ProviderPrivacy> = {
  claude: {
    label: "Claude (Anthropic)",
    region: "US",
    policyUrl: "https://www.anthropic.com/legal/privacy",
    clearPolicy: true,
    note: "API data isn't used to train models by default; retained briefly for abuse monitoring.",
  },
  openai: {
    label: "OpenAI",
    region: "US",
    policyUrl: "https://openai.com/enterprise-privacy",
    clearPolicy: true,
    note: "API data isn't used to train models by default; retained up to ~30 days for abuse monitoring.",
  },
  deepseek: {
    label: "DeepSeek",
    region: "China",
    policyUrl: "https://platform.deepseek.com/downloads/DeepSeek%20Privacy%20Policy.html",
    clearPolicy: false,
    note: "Data is processed in China and training use isn't clearly excluded — avoid confidential material with this model.",
  },
};

/** Providers whose published API policy clearly excludes training use. */
export function clearPolicyProviders(): Provider[] {
  return (Object.keys(PROVIDER_PRIVACY) as Provider[]).filter(
    (p) => PROVIDER_PRIVACY[p].clearPolicy
  );
}

export interface Subprocessor {
  name: string;
  role: string;
  data: string;
  region: string;
  /** When this vendor actually receives data ("Always" or the condition). */
  when: string;
  policyUrl: string;
}

export const SUBPROCESSORS: Subprocessor[] = [
  {
    name: "Vercel",
    role: "Hosting, serverless functions, cookieless web analytics",
    data: "All request traffic (platform logs: IP, user agent, path); aggregated page views",
    region: "US",
    when: "Always",
    policyUrl: "https://vercel.com/legal/privacy-policy",
  },
  {
    name: "Supabase",
    role: "Accounts (auth) and database",
    data: "Email / OAuth identity, saved projects, workspace experiments & outcomes, usage entitlements",
    region: "Operator-chosen project region",
    when: "Only when accounts are configured and you sign in",
    policyUrl: "https://supabase.com/privacy",
  },
  {
    name: "Anthropic",
    role: "AI model (Claude)",
    data: "Your product page text, profile, plan context, and anything you paste to the copilot",
    region: PROVIDER_PRIVACY.claude.region,
    when: "Only for runs where you select Claude",
    policyUrl: PROVIDER_PRIVACY.claude.policyUrl,
  },
  {
    name: "OpenAI",
    role: "AI model (GPT)",
    data: "Same prompt content as Anthropic",
    region: PROVIDER_PRIVACY.openai.region,
    when: "Only for runs where you select OpenAI",
    policyUrl: PROVIDER_PRIVACY.openai.policyUrl,
  },
  {
    name: "DeepSeek",
    role: "AI model",
    data: "Same prompt content as Anthropic",
    region: PROVIDER_PRIVACY.deepseek.region,
    when: "Only for runs where you select DeepSeek",
    policyUrl: PROVIDER_PRIVACY.deepseek.policyUrl,
  },
  {
    name: "Firecrawl",
    role: "Headless rendering of JavaScript-only product pages",
    data: "The product URL being analyzed",
    region: "US",
    when: "Only if configured, and only when a plain fetch of your page comes back empty",
    policyUrl: "https://www.firecrawl.dev/privacy-policy",
  },
  {
    name: "Tavily",
    role: "Web search for community discovery",
    data: "Search queries derived from your product profile (never the raw page text)",
    region: "US",
    when: "Only if configured",
    policyUrl: "https://tavily.com/privacy",
  },
  {
    name: "Polar",
    role: "Merchant of record (checkout, invoices, tax)",
    data: "Purchase identity and transaction data — card numbers never touch PostBeacon",
    region: "EU/US",
    when: "Only when billing is configured and you buy a plan",
    policyUrl: "https://polar.sh/legal/privacy",
  },
  {
    name: "Google",
    role: "Optional OAuth sign-in",
    data: "OAuth handshake only",
    region: "US",
    when: "Only if you choose “Continue with Google”",
    policyUrl: "https://policies.google.com/privacy",
  },
];

/** One row of the plain-language inventory table on /privacy. */
export interface DataCategory {
  what: string;
  where: string;
  why: string;
  retention: string;
  deletion: string;
}

export const DATA_CATEGORIES: DataCategory[] = [
  {
    what: "Anonymous draft (URL, profile, strategy, drafts, experiments, product memory)",
    where: "Your browser's localStorage — never our servers",
    why: "So you can close the tab and resume",
    retention: "Until you clear it",
    deletion: "“Clear local draft” on the start step, or clear browser data",
  },
  {
    what: "Account identity (email, optional Google sign-in, display name)",
    where: "Supabase (auth)",
    why: "Sign-in and project ownership",
    retention: "Life of your account",
    deletion: "Delete account",
  },
  {
    what: "Saved projects (profile, fact ledger, strategy, generated content, calendar)",
    where: "Supabase, in rows only you can read (row-level security)",
    why: "Your launch plans, saved across devices",
    retention: "Until you delete the project or account",
    deletion: "Delete project (×) or delete account",
  },
  {
    what: "Workspace data (experiments, outcomes/metrics you type, tasks, audit log, product memory)",
    where: "Supabase, same owner-only rules",
    why: "The publish → measure → learn loop",
    retention: "With its project",
    deletion: "Deleting the project cascades all of it",
  },
  {
    what: "Prompts to the AI model (page text, profile, plan context, pasted feedback)",
    where: "Sent to the model you selected for that run",
    why: "Generating your profile, strategy, content and copilot answers",
    retention:
      "Not stored by us; the provider retains per its API policy (see table below)",
    deletion: "Provider-side, per its policy",
  },
  {
    what: "Copilot chat transcripts",
    where: "Your browser session only",
    why: "The conversation you're having",
    retention: "Gone when the panel session ends — never long-term memory by design",
    deletion: "Automatic",
  },
  {
    what: "Usage metering (plan, launches used, daily calls)",
    where: "Supabase",
    why: "Free-tier limits and abuse prevention",
    retention: "Life of your account",
    deletion: "Delete account",
  },
  {
    what: "Billing",
    where: "Polar (merchant of record) — we store processed webhook event IDs only",
    why: "Payment, invoices, tax",
    retention:
      "Event IDs swept by our retention job; Polar keeps transaction records as required by law",
    deletion: "Contact for our side; Polar per its policy",
  },
  {
    what: "Server logs & analytics",
    where: "Vercel platform logs (IP, path); Vercel Web Analytics (cookieless, aggregated)",
    why: "Operations, security, aggregate traffic",
    retention: "Vercel platform defaults",
    deletion: "Ages out automatically",
  },
];

/**
 * Operator-configured retention window for inactive signed-in projects and
 * webhook event ids. Absent/invalid ⇒ retention sweeping is OFF and data is
 * kept until the user deletes it. Server-only (reads a non-public env var);
 * returns null in the browser. The /privacy page renders whichever is true.
 */
export function retentionDays(): number | null {
  const n = Number(process.env.RETENTION_DAYS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}
