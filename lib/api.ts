import { getSupabase } from "./supabase/client";
import type { AgentRun, AgentRunList } from "./agentRuns";
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
  CopilotReplyV2,
  CopilotRequest,
  Fact,
  AnalysisReceipt,
  EvidenceSourceInput,
  GuestPreviewProviderCapability,
  GuestPreviewResult,
  SuccessContract,
  OpportunityResearch,
  TrialResearchInput,
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
async function authHeader(expectedUserId?: string): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) {
    if (expectedUserId !== undefined)
      throw new Error("Your session changed. Sign in again.");
    return {};
  }
  const { data } = await sb.auth.getSession();
  if (
    expectedUserId !== undefined &&
    (!expectedUserId || data.session?.user.id !== expectedUserId)
  )
    throw new Error("Your session changed. The operation was stopped.");
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function post<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  expectedUserId?: string
): Promise<T> {
  const authorization = await authHeader(expectedUserId);
  signal?.throwIfAborted();
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authorization },
    body: JSON.stringify(body),
    signal,
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

/** Same response contract as post(), but intentionally carries no account
 * bearer. Only the separately quota-gated guest preview may use this seam. */
async function postGuest<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const response = data as { error?: string; code?: ApiErrorCode };
    const err = new Error(response.error || `${path} failed`) as ApiError;
    err.code = response.code;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

// Single typed surface for the browser → server calls. Keeps fetch boilerplate
// out of components and the hook.
/** Bound model context without changing durable/exported project history. */
export function boundedCopilotRequest(body: CopilotRequest): CopilotRequest {
  return {
    ...body,
    workspace: body.workspace
      ? {
          ...body.workspace,
          experiments: body.workspace.experiments.slice(-30).map((experiment) => ({
            ...experiment,
            outcomes: experiment.outcomes.slice(-6),
          })),
          taskLog: [],
          auditLog: [],
          opportunityResearch: undefined,
        }
      : undefined,
  };
}

export const api = {
  agentRuns: async (
    projectId: string,
    ownerId: string,
    signal?: AbortSignal
  ): Promise<AgentRunList> => {
    const authorization = await authHeader(ownerId);
    signal?.throwIfAborted();
    const res = await fetch(`/api/agent-runs?projectId=${encodeURIComponent(projectId)}`, {
      headers: authorization,
      cache: "no-store",
      signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Agent tasks could not be loaded.");
    return data;
  },
  agentCommand: (body: unknown, ownerId: string, signal?: AbortSignal) =>
    post<AgentRun>("/api/agent-runs", body, signal, ownerId),
  providers: () =>
    fetch("/api/providers").then((r) => r.json()) as Promise<{
      providers: Provider[];
      guestPreviewEnabled?: boolean;
      guestPreview?: GuestPreviewProviderCapability;
    }>,
  /** Signed-out, strictly quota-limited preview. Deliberately does not attach
   * an account bearer token or persist the returned data. */
  guestPreview: (url: string, deepseekConsent: boolean, signal?: AbortSignal) =>
    postGuest<GuestPreviewResult>("/api/preview", { url, deepseekConsent }, signal),
  analyze: (
    url: string,
    provider: Provider,
    evidenceSources: EvidenceSourceInput[] = [],
    signal?: AbortSignal
  ) =>
    post<{
      profile: ProductProfile;
      facts: Fact[];
      questions: ClarifyingQuestion[];
      meta: GenerationMeta;
      receipt: AnalysisReceipt;
      page: { url: string; title: string };
    }>("/api/analyze", { url, provider, evidenceSources }, signal),
  strategy: (
    profile: ProductProfile,
    provider: Provider,
    facts: Fact[],
    successContract?: SuccessContract,
    signal?: AbortSignal
  ) =>
    post<MarketingStrategy>(
      "/api/strategy",
      {
        profile,
        provider,
        facts,
        successContract,
      },
      signal
    ),
  generate: (
    profile: ProductProfile,
    platformIds: string[],
    provider: Provider,
    facts: Fact[],
    successContract?: SuccessContract,
    signal?: AbortSignal
  ) =>
    post<GenerateResult>(
      "/api/generate",
      {
        profile,
        platformIds,
        provider,
        facts,
        successContract,
      },
      signal
    ),
  regenerate: (
    profile: ProductProfile,
    platformId: string,
    provider: Provider,
    facts: Fact[],
    successContract?: SuccessContract,
    signal?: AbortSignal
  ) =>
    post<{ posts: PlatformPost[]; playbook?: PlatformPlaybook; meta?: GenerationMeta }>(
      "/api/regenerate",
      { profile, platformId, provider, facts, successContract },
      signal
    ),
  copilot: (body: CopilotRequest, signal?: AbortSignal) =>
    post<CopilotReplyV2>("/api/copilot", boundedCopilotRequest(body), signal),
  opportunities: (
    body: {
      provider: "openai" | "deepseek";
      productUrl: string;
      profile: ProductProfile;
      facts: Fact[];
      successContract: SuccessContract;
      input: TrialResearchInput;
      bannedClaims?: string[];
    },
    signal?: AbortSignal
  ) => post<OpportunityResearch>("/api/opportunities", body, signal),
  usage: async (): Promise<UsageInfo> => {
    const res = await fetch("/api/usage", { headers: { ...(await authHeader()) } });
    return res.json();
  },
  checkout: () => post<{ url: string }>("/api/billing/checkout", {}),
  // ---- data rights (M17) ----
  /** Everything the signed-in user owns, as a pretty-printed JSON string. */
  exportAccount: async (expectedUserId: string, signal?: AbortSignal): Promise<string> => {
    const authorization = await authHeader(expectedUserId);
    signal?.throwIfAborted();
    const res = await fetch("/api/account/export", {
      headers: authorization,
      signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || "Export failed.");
    }
    return res.text();
  },
  deleteAccount: (expectedUserId: string, signal?: AbortSignal) =>
    post<{ ok: boolean }>(
      "/api/account/delete",
      { confirm: "delete my account" },
      signal,
      expectedUserId
    ),
};
