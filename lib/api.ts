import type {
  Provider,
  ProductProfile,
  MarketingStrategy,
  GenerateResult,
} from "./types";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${path} failed`);
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
};
