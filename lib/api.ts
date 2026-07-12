import { getSupabase } from "./supabase/client";
import type { ApiErrorCode } from "./errors";
import type {
  Provider,
  ProductProfile,
  MarketingStrategy,
  GenerateResult,
  GenerationMeta,
  PlatformPost,
  PlatformPlaybook,
  ClarifyingQuestion,
  CopilotReply,
  CopilotRequest,
  Fact,
} from "./types";

export interface UsageInfo {
  enabled: boolean;
  signedIn?: boolean;
  plan?: string;
  used?: number;
  limit?: number;
  remaining?: number | null;
}

export interface ApiError extends Error {
  code?: ApiErrorCode;
  status?: number;
}

/** Attach the Supabase access token so the server can identify the user. */
async function authHeader(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) return {};
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Every route emits the shared ApiErrorBody shape (lib/errors.ts).
    const body = data as { error?: string; code?: ApiErrorCode };
    const err = new Error(body.error || `${path} failed`) as ApiError;
    err.code = body.code;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

// Single typed surface for the browser → server calls. Keeps fetch boilerplate
// out of components and the hook.
export const api = {
  providers: () =>
    fetch("/api/providers").then((r) => r.json()) as Promise<{
      providers: Provider[];
    }>,
  analyze: (url: string, provider: Provider) =>
    post<{
      profile: ProductProfile;
      facts: Fact[];
      questions: ClarifyingQuestion[];
      meta: GenerationMeta;
      page: { url: string; title: string };
    }>("/api/analyze", { url, provider }),
  strategy: (profile: ProductProfile, provider: Provider, facts: Fact[]) =>
    post<MarketingStrategy>("/api/strategy", { profile, provider, facts }),
  generate: (
    profile: ProductProfile,
    platformIds: string[],
    provider: Provider,
    facts: Fact[]
  ) => post<GenerateResult>("/api/generate", { profile, platformIds, provider, facts }),
  regenerate: (
    profile: ProductProfile,
    platformId: string,
    provider: Provider,
    facts: Fact[]
  ) =>
    post<{ posts: PlatformPost[]; playbook?: PlatformPlaybook; meta?: GenerationMeta }>(
      "/api/regenerate",
      { profile, platformId, provider, facts }
    ),
  copilot: (body: CopilotRequest) => post<CopilotReply>("/api/copilot", body),
  usage: async (): Promise<UsageInfo> => {
    const res = await fetch("/api/usage", { headers: { ...(await authHeader()) } });
    return res.json();
  },
  checkout: () => post<{ url: string }>("/api/billing/checkout", {}),
};
