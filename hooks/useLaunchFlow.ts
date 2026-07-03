"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { loadDraft } from "@/lib/storage";
import { DEMO_PROJECT } from "@/lib/demo";
import { PLATFORMS } from "@/lib/platforms";
import type {
  Provider,
  ProductProfile,
  MarketingStrategy,
  GenerateResult,
  PlatformContent,
  PlatformPost,
  PlatformRecommendation,
  ScheduleItem,
} from "@/lib/types";

export type Step = "input" | "profile" | "strategy" | "results";

// Default channel set: the 4 best-scoring recommendations. A tight default —
// content is only written for checked channels, and a focused plan beats a
// sprawling one. Sorted explicitly; the model's array order isn't trusted.
function defaultSelection(recs?: PlatformRecommendation[]): string[] {
  if (!recs?.length) return [];
  return [...recs]
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((r) => r.platformId);
}

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
  const [demo, setDemo] = useState(false); // viewing the baked-in example (autosave is paused)
  const [pendingDraft, setPendingDraft] = useState<any>(null); // saved draft offered for resume on mount

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
      setDemo(false);
      const { profile } = await api.analyze(url, provider);
      setProfile(profile);
      setStep("profile");
    }, "Reading your landing page…");

  const buildStrategy = () =>
    run(async () => {
      if (!profile) return;
      const s = await api.strategy(profile, provider);
      setStrategy(s);
      setSelected(defaultSelection(s.recommendations));
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

  // ---- Plan editing (M11). Pure state patches: autosave, export and the
  // ---- Copilot context all read this state, so edits flow through for free.

  const updateStrategy = (patch: Partial<MarketingStrategy>) =>
    setStrategy((s) => (s ? { ...s, ...patch } : s));

  const updateRecommendation = (
    platformId: string,
    patch: Partial<PlatformRecommendation>
  ) =>
    setStrategy((s) =>
      s
        ? {
            ...s,
            recommendations: s.recommendations.map((r) =>
              r.platformId === platformId ? { ...r, ...patch } : r
            ),
          }
        : s
    );

  // Schedule edits re-sort by day inside the producer, so the render and the
  // next index-based edit always see the same order.
  const updateScheduleItem = (idx: number, patch: Partial<ScheduleItem>) =>
    setResult((r) =>
      r
        ? {
            ...r,
            schedule: r.schedule
              .map((s, i) => (i === idx ? { ...s, ...patch } : s))
              .sort((a, b) => a.day - b.day),
          }
        : r
    );

  const removeScheduleItem = (idx: number) =>
    setResult((r) =>
      r ? { ...r, schedule: r.schedule.filter((_, i) => i !== idx) } : r
    );

  const addScheduleItem = (item: ScheduleItem) =>
    setResult((r) =>
      r
        ? { ...r, schedule: [...r.schedule, item].sort((a, b) => a.day - b.day) }
        : r
    );

  // Drop a channel from the plan. Content, calendar steps, posted marks and
  // the generation set go together so counts and re-generates never drift.
  const removeChannel = (platformId: string) => {
    setResult((r) =>
      r
        ? {
            content: r.content.filter((c) => c.platformId !== platformId),
            schedule: r.schedule.filter((s) => s.platformId !== platformId),
          }
        : r
    );
    setPosted((p) =>
      Object.fromEntries(
        Object.entries(p).filter(([k]) => !k.startsWith(`${platformId}-`))
      )
    );
    setSelected((s) => s.filter((x) => x !== platformId));
  };

  // Write content for one more channel after generation, slotting it into the
  // plan at its ranked position (content order, calendar, selection).
  const addChannel = (platformId: string) => {
    const platform = PLATFORMS.find((p) => p.id === platformId);
    if (!platform) return Promise.resolve();
    return run(async () => {
      if (!profile) return;
      setPaywall(null);
      try {
        const { posts, playbook } = await api.regenerate(
          profile,
          platformId,
          provider
        );
        const block: PlatformContent = {
          platformId,
          platformName: platform.name,
          posts,
          playbook,
        };
        setResult((r) => {
          if (!r || r.content.some((c) => c.platformId === platformId)) return r;
          const rank = new Map(
            (strategy?.recommendations ?? []).map((rec, i) => [rec.platformId, i])
          );
          return {
            content: [...r.content, block].sort(
              (a, b) =>
                (rank.get(a.platformId) ?? Infinity) -
                (rank.get(b.platformId) ?? Infinity)
            ),
            // Same action template the server uses, so the calendar reads uniformly.
            schedule: [
              ...r.schedule,
              {
                day: platform.defaultDay,
                platformId,
                platformName: platform.name,
                action: `Post to ${platform.name} — ${platform.blurb} (${platform.bestTime})`,
              },
            ].sort((a, b) => a.day - b.day),
          };
        });
        setSelected((s) => (s.includes(platformId) ? s : [...s, platformId]));
      } catch (e: any) {
        if (e?.code === "auth") return setPaywall("auth");
        if (e?.code === "paywall") return setPaywall("limit");
        throw e;
      }
    }, `Writing content for ${platform.name}…`);
  };

  const togglePosted = (id: string) =>
    setPosted((p) => ({ ...p, [id]: !p[id] }));

  const reset = () => {
    setDemo(false);
    setStep("input");
    setUrl("");
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
    setLaunchDate(p.launchDate || p.meta?.launchDate || "");
    setProjectId(p.id || "");
    // Three generations of saved data: flat `selected` (local draft), `meta`
    // (Supabase row), or neither (pre-M11 saves) → derive a fresh default.
    setSelected(
      p.selected ??
        p.meta?.selected ??
        defaultSelection(p.strategy?.recommendations)
    );
    setStep(
      p.result ? "results" : p.strategy ? "strategy" : p.profile ? "profile" : "input"
    );
  };

  // Load the baked-in example plan (no API call, works with zero keys). Marked
  // as `demo` so autosave skips it and it never overwrites the user's own draft.
  const loadDemo = useCallback(() => {
    setError("");
    setDemo(true);
    loadProject(DEMO_PROJECT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resume / discard the in-progress draft surfaced on mount.
  const resumeDraft = () => {
    if (pendingDraft) loadProject(pendingDraft);
    setPendingDraft(null);
  };
  const dismissDraft = () => setPendingDraft(null);

  // On mount: a `?demo=1` deep link opens the example; otherwise we *offer* to
  // resume any in-progress draft (a banner on the input step) rather than
  // silently dropping the user into their last project — opening /app should
  // feel like a fresh start unless they choose to continue.
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("demo") === "1"
    ) {
      loadDemo();
      return;
    }
    const draft = loadDraft();
    if (draft && (draft.profile || draft.url)) setPendingDraft(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable identity unless the contents change — lets autosave depend on the
  // object reference instead of re-serializing it every render.
  const snapshot = useMemo(
    () => ({ url, profile, strategy, result, posted, selected }),
    [url, profile, strategy, result, posted, selected]
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
    updateStrategy,
    updateRecommendation,
    updateScheduleItem,
    removeScheduleItem,
    addScheduleItem,
    removeChannel,
    addChannel,
    launchDate,
    setLaunchDate,
    projectId,
    setProjectId,
    paywall,
    setPaywall,
    generations,
    demo,
    loadDemo,
    pendingDraft,
    resumeDraft,
    dismissDraft,
    analyze,
    buildStrategy,
    generate,
    reset,
    loadProject,
    snapshot,
  };
}
