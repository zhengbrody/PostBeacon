"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { loadDraft } from "@/lib/storage";
import type {
  Provider,
  ProductProfile,
  MarketingStrategy,
  GenerateResult,
  PlatformPost,
} from "@/lib/types";

export type Step = "input" | "profile" | "strategy" | "results";

/**
 * The whole 4-step launch flow as one hook: state machine + API actions +
 * load/restore for saved projects. Components stay presentational.
 */
export function useLaunchFlow() {
  const [step, setStep] = useState<Step>("input");
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState<Provider>("claude");
  const [availProviders, setAvailProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");

  const [profile, setProfile] = useState<ProductProfile | null>(null);
  const [strategy, setStrategy] = useState<MarketingStrategy | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [posted, setPosted] = useState<Record<string, boolean>>({});
  const [launchDate, setLaunchDate] = useState("");
  const [projectId, setProjectId] = useState(""); // stable id of the current project (for autosave upsert)
  const [paywall, setPaywall] = useState<"auth" | "limit" | null>(null);
  const [generations, setGenerations] = useState(0); // bumps once per successful generate (usage refetch trigger)

  useEffect(() => {
    api
      .providers()
      .then((d) => {
        if (d.providers?.length) {
          setAvailProviders(d.providers);
          setProvider(d.providers[0]);
        }
      })
      .catch(() => {});
  }, []);

  const run = useCallback(async (fn: () => Promise<void>, msg: string) => {
    setError("");
    setLoading(true);
    setLoadingMsg(msg);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
      setLoadingMsg("");
    }
  }, []);

  const analyze = () =>
    run(async () => {
      const { profile } = await api.analyze(url, provider);
      setProfile(profile);
      setStep("profile");
    }, "Reading your landing page…");

  const buildStrategy = () =>
    run(async () => {
      if (!profile) return;
      const s = await api.strategy(profile, provider);
      setStrategy(s);
      setSelected(
        s.recommendations
          .filter((r) => r.priority !== "low")
          .map((r) => r.platformId)
      );
      setStep("strategy");
    }, "Scanning every platform & ranking your channels…");

  const generate = () =>
    run(async () => {
      if (!profile) return;
      setPaywall(null);
      try {
        const r = await api.generate(profile, selected, provider);
        setResult(r);
        setStep("results");
        setGenerations((n) => n + 1);
      } catch (e: any) {
        if (e?.code === "auth") return setPaywall("auth");
        if (e?.code === "paywall") return setPaywall("limit");
        throw e;
      }
    }, "Writing your launch content…");

  // Rewrite one platform's content in place, leaving the rest of the results intact.
  const regeneratePost = (platformId: string) =>
    run(async () => {
      if (!profile) return;
      const { posts, playbook } = await api.regenerate(
        profile,
        platformId,
        provider
      );
      setResult((r) =>
        r
          ? {
              ...r,
              content: r.content.map((c) =>
                c.platformId === platformId
                  ? { ...c, posts, playbook: playbook ?? c.playbook }
                  : c
              ),
            }
          : r
      );
    }, "Rewriting this channel…");

  // Inline edit of a single generated post — edits live in `result` so they
  // flow into export (and, once persisted, autosave) for free.
  const updatePost = (
    platformId: string,
    idx: number,
    patch: Partial<PlatformPost>
  ) =>
    setResult((r) =>
      r
        ? {
            ...r,
            content: r.content.map((c) =>
              c.platformId === platformId
                ? {
                    ...c,
                    posts: c.posts.map((p, i) =>
                      i === idx ? { ...p, ...patch } : p
                    ),
                  }
                : c
            ),
          }
        : r
    );

  const toggleSelected = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id]
    );

  const togglePosted = (id: string) =>
    setPosted((p) => ({ ...p, [id]: !p[id] }));

  const reset = () => {
    setStep("input");
    setProfile(null);
    setStrategy(null);
    setResult(null);
    setSelected([]);
    setPosted({});
    setLaunchDate("");
    setProjectId("");
    setError("");
  };

  const loadProject = (p: any) => {
    setUrl(p.url || "");
    setProfile(p.profile || null);
    setStrategy(p.strategy || null);
    setResult(p.result || null);
    setPosted(p.posted || {});
    setLaunchDate(p.launchDate || "");
    setProjectId(p.id || "");
    if (p.strategy?.recommendations) {
      setSelected(
        p.strategy.recommendations
          .filter((r: any) => r.priority !== "low")
          .map((r: any) => r.platformId)
      );
    }
    setStep(
      p.result ? "results" : p.strategy ? "strategy" : p.profile ? "profile" : "input"
    );
  };

  // Hydrate an in-progress draft on mount (anonymous work survives a refresh; on
  // sign-in, autosave migrates it to the account and clears the local copy).
  useEffect(() => {
    const draft = loadDraft();
    if (draft && (draft.profile || draft.url)) loadProject(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable identity unless the contents change — lets autosave depend on the
  // object reference instead of re-serializing it every render.
  const snapshot = useMemo(
    () => ({ url, profile, strategy, result, posted }),
    [url, profile, strategy, result, posted]
  );

  return {
    step,
    setStep,
    url,
    setUrl,
    provider,
    setProvider,
    availProviders,
    loading,
    loadingMsg,
    error,
    profile,
    setProfile,
    strategy,
    selected,
    toggleSelected,
    result,
    posted,
    togglePosted,
    regeneratePost,
    updatePost,
    launchDate,
    setLaunchDate,
    projectId,
    setProjectId,
    paywall,
    setPaywall,
    generations,
    analyze,
    buildStrategy,
    generate,
    reset,
    loadProject,
    snapshot,
  };
}
