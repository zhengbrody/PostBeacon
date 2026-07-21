// The single source of truth for PostBeacon's public privacy claims (M17).
// The /privacy, /terms and /subprocessors pages, the model picker's data notes,
// and the provider default ordering all render from THIS file, so the published
// statements can't drift from what the code does. Full inventory + threat model:
// docs/M17-privacy-trust.md. During private beta this is a factual product/data
// notice, not a claim about a future company, paid service, or jurisdiction.

import type { Provider } from "./types";
import { guestPreviewQuotaConfigured } from "./guestPreviewQuota";

/** Bump when the published policy text meaningfully changes. */
export const PRIVACY_LAST_UPDATED = "2026-07-21";

/**
 * How each LLM provider handles API data, per its PUBLIC policy as of
 * PRIVACY_LAST_UPDATED (re-verify before changing provider configuration or
 * publishing these statements outside the private beta).
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

function providerConfigured(provider: Provider): boolean {
  const keyByProvider: Record<Provider, string | undefined> = {
    claude: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
  };
  return Boolean(keyByProvider[provider]);
}

/** Provider disclosures for models that this deployment can actually call. */
export function configuredProviderPrivacy(): ProviderPrivacy[] {
  return (Object.keys(PROVIDER_PRIVACY) as Provider[])
    .filter(providerConfigured)
    .map((provider) => PROVIDER_PRIVACY[provider]);
}

/** Providers whose published API policy clearly excludes training use. */
export function clearPolicyProviders(): Provider[] {
  return (Object.keys(PROVIDER_PRIVACY) as Provider[]).filter(
    (p) => PROVIDER_PRIVACY[p].clearPolicy
  );
}

/**
 * Explicit beta operator opt-in. It is public on purpose: the server behavior
 * and the disclosure rendered before a model call must read the same value.
 */
export function deepseekAutomaticFallbackEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEEPSEEK_FALLBACK === "true";
}

/** Providers eligible as automatic fallback destinations. */
export function automaticFallbackProviders(): Provider[] {
  return deepseekAutomaticFallbackEnabled()
    ? [...clearPolicyProviders(), "deepseek"]
    : clearPolicyProviders();
}

/** Short disclosure shared by the URL step, Copilot and landing FAQ. */
export function providerFallbackNotice(): string {
  return deepseekAutomaticFallbackEnabled()
    ? "If the primary model is unavailable, PostBeacon may retry with another configured provider. During this beta that can include DeepSeek, which processes data in China and does not clearly exclude training use; avoid confidential material."
    : "If the primary model is unavailable, PostBeacon may retry with another configured clear-policy provider. DeepSeek is never an automatic fallback.";
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
    when: "Only if configured, and when selected as primary or used as a clear-policy fallback",
    policyUrl: PROVIDER_PRIVACY.claude.policyUrl,
  },
  {
    name: "OpenAI",
    role: "AI model (GPT)",
    data: "Your product page text, profile, plan context, and anything you paste to the copilot",
    region: PROVIDER_PRIVACY.openai.region,
    when: "Only if configured, and when selected as primary or used as a clear-policy fallback",
    policyUrl: PROVIDER_PRIVACY.openai.policyUrl,
  },
  {
    name: "DeepSeek",
    role: "AI model",
    data: "Your product page text, profile, plan context, and anything you paste to the copilot",
    region: PROVIDER_PRIVACY.deepseek.region,
    when: deepseekAutomaticFallbackEnabled()
      ? "When selected as primary, or as the explicitly enabled beta fallback after another provider fails"
      : "Only for runs where you select DeepSeek",
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
  {
    name: "Resend",
    role: "Opt-in event email delivery",
    data: "Your account email, project name, and the reminder event that is due",
    region: "US",
    when: "Only when email reminders are configured and you explicitly turn them on",
    policyUrl: "https://resend.com/legal/privacy-policy",
  },
  {
    name: "Upstash",
    role: "Anonymous preview abuse limits",
    data: "A keyed digest of a random visitor token and aggregate request counts — never the submitted URL, page text, IP, user agent, or draft",
    region: "Operator-chosen database region",
    when: "Only when the signed-out one-channel preview is enabled",
    policyUrl: "https://upstash.com/trust/privacy.pdf",
  },
];

/** Whether paid billing is actually live in this deployment. */
export function billingConfigured(): boolean {
  return Boolean(
    process.env.POLAR_ACCESS_TOKEN &&
    process.env.POLAR_PRODUCT_ID &&
    process.env.POLAR_WEBHOOK_SECRET
  );
}

/** Email opt-in is public only when the complete sending path is live. */
export function emailRemindersConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_EMAIL_REMINDERS_ENABLED === "true" &&
    process.env.RESEND_API_KEY &&
    process.env.REMINDER_FROM_EMAIL &&
    process.env.CRON_SECRET &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function accountsConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/** Public only when the model path and persistent, fail-closed quota boundary
 * are both configured. */
export function guestPreviewConfigured(): boolean {
  const clearProviderConfigured =
    providerConfigured("claude") || providerConfigured("openai");
  const deepseekConfigured = providerConfigured("deepseek");
  const providerAvailable = clearProviderConfigured || deepseekConfigured;
  const couldSendToDeepSeek =
    deepseekConfigured && (!clearProviderConfigured || deepseekAutomaticFallbackEnabled());
  return Boolean(
    providerAvailable &&
    process.env.GUEST_PREVIEW_ENABLED === "true" &&
    (process.env.GUEST_PREVIEW_SIGNING_SECRET?.length ?? 0) >= 32 &&
    guestPreviewQuotaConfigured() &&
    (!couldSendToDeepSeek || process.env.GUEST_PREVIEW_ALLOW_DEEPSEEK === "true")
  );
}

/**
 * Public page = currently configured vendors, not every dormant integration in
 * the repository. This keeps the private-beta disclosure factual and concise.
 */
export function activeSubprocessors(): Subprocessor[] {
  return SUBPROCESSORS.filter((vendor) => {
    switch (vendor.name) {
      case "Supabase":
      case "Google":
        return Boolean(
          process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        );
      case "Anthropic":
        return providerConfigured("claude");
      case "OpenAI":
        return providerConfigured("openai");
      case "DeepSeek":
        return providerConfigured("deepseek");
      case "Firecrawl":
        return Boolean(process.env.SCRAPE_API_KEY);
      case "Tavily":
        return Boolean(process.env.SEARCH_API_KEY);
      case "Polar":
        return billingConfigured();
      case "Resend":
        return emailRemindersConfigured();
      case "Upstash":
        return guestPreviewConfigured();
      default:
        return true;
    }
  });
}

/** One row of the plain-language inventory table on /privacy. */
export interface DataCategory {
  what: string;
  where: string;
  why: string;
  retention: string;
  deletion: string;
  /** Hide dormant product surfaces from the current public beta notice. */
  requires?: "billing" | "reminders" | "guestPreview" | "localDraft";
}

export const DATA_CATEGORIES: DataCategory[] = [
  {
    what: "Anonymous full draft (URL, profile, strategy, drafts, experiments, product memory)",
    where: "Your browser's localStorage — never our servers",
    why: "Local-only mode when accounts are not configured",
    retention: "Until you clear it",
    deletion: "“Clear local draft” on the start step, or clear browser data",
    requires: "localDraft",
  },
  {
    what: "Signed-out one-channel preview (URL and returned product/channel/draft summary)",
    where:
      "Processed by the server and AI provider; the result is kept in this browser's localStorage only for the sign-in handoff",
    why: "Give one useful result before sign-in and preserve it across a same-browser sign-in",
    retention:
      "Up to 1 hour in this browser; PostBeacon does not write it to the projects database",
    deletion: "“Clear this preview” or clear browser data",
    requires: "guestPreview",
  },
  {
    what: "Signed-out preview quota identity",
    where:
      "A signed random browser cookie; Upstash receives only a keyed digest and per-window counters",
    why: "Enforce one visitor limit and a shared hard spend cap without IP or device fingerprinting",
    retention:
      "Cookie up to 30 days; quota counters expire after the configured window (24h by default)",
    deletion:
      "Clear site cookies; server counters expire automatically and contain no submitted content",
    requires: "guestPreview",
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
    where: deepseekAutomaticFallbackEnabled()
      ? "Sent to your primary model; on availability/credit/rate-limit failure, another configured provider (including DeepSeek during this beta) may receive the retry"
      : "Sent to your primary model; on availability/credit/rate-limit failure, a clear-policy fallback may receive the retry",
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
    why: "Private-beta usage limits and abuse prevention",
    retention: "Life of your account",
    deletion: "Delete account",
  },
  {
    what: "Opt-in reminder delivery history",
    where: "Supabase tasks (delivery deduplication) and Resend (email delivery)",
    why: "Send a reminder only when a 24h, 72h or weekly-review action is due",
    retention: "With its project",
    deletion: "Turn reminders off; deleting the project/account removes our history",
    requires: "reminders",
  },
  {
    what: "Billing",
    where: "Polar (merchant of record) — we store processed webhook event IDs only",
    why: "Payment, invoices, tax",
    retention:
      "Event IDs swept by our retention job; Polar keeps transaction records as required by law",
    deletion: "Contact for our side; Polar per its policy",
    requires: "billing",
  },
  {
    what: "Server logs & analytics",
    where: "Vercel platform logs (IP, path); Vercel Web Analytics (cookieless, aggregated)",
    why: "Operations, security, aggregate traffic",
    retention: "Vercel platform defaults",
    deletion: "Ages out automatically",
  },
];

/** Data inventory rows that describe features active in this deployment. */
export function visibleDataCategories(): DataCategory[] {
  return DATA_CATEGORIES.filter((category) => {
    if (category.requires === "billing") return billingConfigured();
    if (category.requires === "reminders") return emailRemindersConfigured();
    if (category.requires === "guestPreview") return guestPreviewConfigured();
    if (category.requires === "localDraft") return !accountsConfigured();
    return true;
  });
}

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
