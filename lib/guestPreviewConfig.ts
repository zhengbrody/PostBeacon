import { PublicError } from "./errors";
import { availableProviders } from "./llm";
import {
  automaticFallbackProviders,
  guestPreviewConfigured,
  PROVIDER_PRIVACY,
} from "./privacy";
import type { GuestPreviewProviderCapability, Provider } from "./types";

export interface GuestPreviewConfig {
  secret: string;
  provider: Provider;
  windowSeconds: number;
  perVisitorLimit: number;
  globalLimit: number;
  tokenMaxAgeSeconds: number;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** The exact provider path the server can use for a guest preview, including
 * the disclosure material needed before DeepSeek can receive page data. */
export function guestPreviewProviderCapability(): GuestPreviewProviderCapability {
  const providers = availableProviders();
  const primaryProvider = providers[0] ?? null;
  const fallbackAllowlist = new Set(automaticFallbackProviders());
  const eligibleFallbackProviders = primaryProvider
    ? providers.filter(
        (provider) => provider !== primaryProvider && fallbackAllowlist.has(provider)
      )
    : [];
  const deepseekEligible =
    primaryProvider === "deepseek" || eligibleFallbackProviders.includes("deepseek");
  const guestDataOptIn = process.env.GUEST_PREVIEW_ALLOW_DEEPSEEK === "true";
  const enabled = guestPreviewConfigured();

  return {
    enabled,
    primaryProvider,
    eligibleFallbackProviders,
    deepseek: {
      eligible: deepseekEligible,
      guestDataOptIn,
      mayReceivePreviewData: enabled && deepseekEligible,
      priorWarningRequired: enabled && deepseekEligible,
      region: PROVIDER_PRIVACY.deepseek.region,
      policyUrl: PROVIDER_PRIVACY.deepseek.policyUrl,
      notice: PROVIDER_PRIVACY.deepseek.note,
    },
  };
}

/** Feature and privacy gate. Any incomplete configuration is unavailable; no
 * in-memory quota or unclear-policy provider is selected as a fallback. */
export function guestPreviewConfig(): GuestPreviewConfig {
  if (!guestPreviewConfigured()) {
    throw new PublicError("Guest preview is unavailable.", 503);
  }
  const secret = process.env.GUEST_PREVIEW_SIGNING_SECRET ?? "";

  const provider = availableProviders()[0];
  if (!provider) throw new PublicError("Guest preview is unavailable.", 503);

  return {
    secret,
    provider,
    windowSeconds: intEnv("GUEST_PREVIEW_WINDOW_SECONDS", 86_400, 300, 604_800),
    perVisitorLimit: intEnv("GUEST_PREVIEW_PER_VISITOR_LIMIT", 1, 1, 10),
    globalLimit: intEnv("GUEST_PREVIEW_GLOBAL_LIMIT", 25, 1, 10_000),
    tokenMaxAgeSeconds: intEnv(
      "GUEST_PREVIEW_TOKEN_MAX_AGE_SECONDS",
      2_592_000,
      86_400,
      7_776_000
    ),
  };
}
