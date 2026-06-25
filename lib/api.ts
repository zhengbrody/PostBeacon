import { getSupabase } from "./supabase/client";
import type {
  Provider,
  ProductProfile,
  MarketingStrategy,
  GenerateResult,
  PlatformPost,
  PlatformPlaybook,
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
  code?: string; // e.g. "auth" | "paywall"
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
    const err = new Error(data.error || `${path} failed`) as ApiError;
    err.code = data.code;
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
    post<{ profile: ProductProfile; page: { url: string; title: string } }>(
      "/api/analyze",
      { url, provider }
    ),
  strategy: (profile: ProductProfile, provider: Provider) =>
    post<MarketingStrategy>("/api/strategy", { profile, provider }),
  generate: (
    profile: ProductProfile,
    platformIds: string[],
    provider: Provider
  ) => post<GenerateResult>("/api/generate", { profile, platformIds, provider }),
  regenerate: (profile: ProductProfile, platformId: string, provider: Provider) =>
    post<{ posts: PlatformPost[]; playbook?: PlatformPlaybook }>(
      "/api/regenerate",
      { profile, platformId, provider }
    ),
  usage: async (): Promise<UsageInfo> => {
    const res = await fetch("/api/usage", { headers: { ...(await authHeader()) } });
    return res.json();
  },
  checkout: () => post<{ url: string }>("/api/billing/checkout", {}),
};
