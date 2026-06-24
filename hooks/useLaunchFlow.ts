"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type {
  Provider,
  ProductProfile,
  MarketingStrategy,
  GenerateResult,
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
      const r = await api.generate(profile, selected, provider);
      setResult(r);
      setStep("results");
    }, "Writing your launch content…");

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
    setError("");
  };

  const loadProject = (p: any) => {
    setUrl(p.url || "");
    setProfile(p.profile || null);
    setStrategy(p.strategy || null);
    setResult(p.result || null);
    setPosted(p.posted || {});
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
    analyze,
    buildStrategy,
    generate,
    reset,
    loadProject,
    snapshot: { url, profile, strategy, result, posted },
  };
}
