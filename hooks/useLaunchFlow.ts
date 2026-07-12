"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { api } from "@/lib/api";
import { loadDraft } from "@/lib/storage";
import { DEMO_PROJECT } from "@/lib/demo";
import { PLATFORMS } from "@/lib/platforms";
import type { ContextField } from "@/lib/facts";
import {
  flowReducer,
  initialFlowState,
  type LoadedProject,
  type Step,
} from "./launchFlowReducer";
import type {
  Provider,
  MarketingStrategy,
  PlatformPost,
  PlatformRecommendation,
  ProductProfile,
  ScheduleItem,
} from "@/lib/types";

export type { Step };

/**
 * The whole 4-step launch flow as one hook. All plan state lives in the pure
 * reducer (hooks/launchFlowReducer.ts) — this hook adds the async API actions
 * and ephemeral UI state (loading/error/paywall), and keeps the same public
 * surface components have always consumed.
 */
export function useLaunchFlow() {
  const [state, dispatch] = useReducer(flowReducer, initialFlowState);
  const [provider, setProvider] = useState<Provider>("claude");
  const [availProviders, setAvailProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [paywall, setPaywall] = useState<"auth" | "limit" | null>(null);
  const [generations, setGenerations] = useState(0); // bumps once per successful generate (usage refetch trigger)
  const [pendingDraft, setPendingDraft] = useState<LoadedProject | null>(null); // saved draft offered for resume on mount

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

  const { url, profile, facts, selected } = state;

  const analyze = () =>
    run(async () => {
      const { profile, facts, questions } = await api.analyze(url, provider);
      dispatch({
        type: "ANALYZED",
        profile,
        facts: facts ?? [],
        questions: questions ?? [],
      });
    }, "Reading your landing page…");

  const buildStrategy = () =>
    run(async () => {
      if (!profile) return;
      const strategy = await api.strategy(profile, provider, facts);
      dispatch({ type: "STRATEGY_BUILT", strategy });
    }, "Scanning every platform & ranking your channels…");

  const generate = () =>
    run(async () => {
      if (!profile) return;
      setPaywall(null);
      try {
        const result = await api.generate(profile, selected, provider, facts);
        dispatch({ type: "GENERATED", result });
        setGenerations((n) => n + 1);
      } catch (e) {
        if (isGateError(e, "auth")) return setPaywall("auth");
        if (isGateError(e, "paywall")) return setPaywall("limit");
        throw e;
      }
    }, "Writing your launch content…");

  // Rewrite one platform's content in place, leaving the rest of the results intact.
  const regeneratePost = (platformId: string) =>
    run(async () => {
      if (!profile) return;
      const { posts, playbook, meta } = await api.regenerate(
        profile,
        platformId,
        provider,
        facts
      );
      dispatch({
        type: "CHANNEL_CONTENT_REPLACED",
        channel: { platformId, posts, playbook, meta },
      });
    }, "Rewriting this channel…");

  // Write content for one more channel after generation (add), or retry one
  // that failed — the reducer slots it into content/calendar/selection and
  // clears any failure entry, all in one transition.
  const upsertChannel = (platformId: string, msg: string) => {
    const platform = PLATFORMS.find((p) => p.id === platformId);
    if (!platform) return Promise.resolve();
    return run(async () => {
      if (!profile) return;
      setPaywall(null);
      try {
        const { posts, playbook, meta } = await api.regenerate(
          profile,
          platformId,
          provider,
          facts
        );
        dispatch({
          type: "CHANNEL_UPSERTED",
          channel: { platformId, posts, playbook, meta },
        });
      } catch (e) {
        if (isGateError(e, "auth")) return setPaywall("auth");
        if (isGateError(e, "paywall")) return setPaywall("limit");
        throw e;
      }
    }, msg);
  };

  const addChannel = (platformId: string) => {
    const name = PLATFORMS.find((p) => p.id === platformId)?.name ?? platformId;
    return upsertChannel(platformId, `Writing content for ${name}…`);
  };

  const retryFailed = (platformId: string) => {
    const name = PLATFORMS.find((p) => p.id === platformId)?.name ?? platformId;
    return upsertChannel(platformId, `Retrying ${name}…`);
  };

  const loadProject = (p: LoadedProject) =>
    dispatch({ type: "PROJECT_LOADED", project: p, demo: false });

  // Load the baked-in example plan (no API call, works with zero keys). Marked
  // as `demo` so autosave skips it and it never overwrites the user's own draft.
  const loadDemo = useCallback(() => {
    setError("");
    dispatch({ type: "PROJECT_LOADED", project: DEMO_PROJECT, demo: true });
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
  }, [loadDemo]);

  // Stable identity unless the contents change — lets autosave depend on the
  // object reference instead of re-serializing it every render.
  const snapshot = useMemo(
    () => ({
      url: state.url,
      profile: state.profile,
      strategy: state.strategy,
      result: state.result,
      posted: state.posted,
      selected: state.selected,
      facts: state.facts,
    }),
    [
      state.url,
      state.profile,
      state.strategy,
      state.result,
      state.posted,
      state.selected,
      state.facts,
    ]
  );

  return {
    step: state.step,
    setStep: (step: Step) => dispatch({ type: "STEP_SET", step }),
    url: state.url,
    setUrl: (u: string) => dispatch({ type: "URL_SET", url: u }),
    provider,
    setProvider,
    availProviders,
    loading,
    loadingMsg,
    error,
    profile: state.profile,
    setProfile: (p: ProductProfile) => dispatch({ type: "PROFILE_SET", profile: p }),
    facts: state.facts,
    questions: state.questions,
    confirmFact: (id: string) => dispatch({ type: "FACT_CONFIRMED", id }),
    correctFact: (id: string, claim: string) =>
      dispatch({ type: "FACT_CORRECTED", id, claim }),
    deleteFact: (id: string) => dispatch({ type: "FACT_DELETED", id }),
    answerQuestion: (id: ContextField, answer: string) =>
      dispatch({ type: "QUESTION_ANSWERED", id, answer }),
    retryFailed,
    strategy: state.strategy,
    selected: state.selected,
    toggleSelected: (platformId: string) =>
      dispatch({ type: "SELECTION_TOGGLED", platformId }),
    result: state.result,
    posted: state.posted,
    togglePosted: (id: string) => dispatch({ type: "POSTED_TOGGLED", id }),
    regeneratePost,
    updatePost: (platformId: string, idx: number, patch: Partial<PlatformPost>) =>
      dispatch({ type: "POST_PATCHED", platformId, idx, patch }),
    updateStrategy: (patch: Partial<MarketingStrategy>) =>
      dispatch({ type: "STRATEGY_PATCHED", patch }),
    updateRecommendation: (platformId: string, patch: Partial<PlatformRecommendation>) =>
      dispatch({ type: "RECOMMENDATION_PATCHED", platformId, patch }),
    updateScheduleItem: (idx: number, patch: Partial<ScheduleItem>) =>
      dispatch({ type: "SCHEDULE_ITEM_PATCHED", idx, patch }),
    removeScheduleItem: (idx: number) => dispatch({ type: "SCHEDULE_ITEM_REMOVED", idx }),
    addScheduleItem: (item: ScheduleItem) =>
      dispatch({ type: "SCHEDULE_ITEM_ADDED", item }),
    removeChannel: (platformId: string) =>
      dispatch({ type: "CHANNEL_REMOVED", platformId }),
    addChannel,
    launchDate: state.launchDate,
    setLaunchDate: (date: string) => dispatch({ type: "LAUNCH_DATE_SET", date }),
    projectId: state.projectId,
    setProjectId: (id: string) => dispatch({ type: "PROJECT_ID_SET", id }),
    paywall,
    setPaywall,
    generations,
    demo: state.demo,
    loadDemo,
    pendingDraft,
    resumeDraft,
    dismissDraft,
    analyze,
    buildStrategy,
    generate,
    reset: () => dispatch({ type: "RESET" }),
    loadProject,
    snapshot,
  };
}

/** Narrow an api.ts ApiError without `any`: gated 401/402s carry a code. */
function isGateError(e: unknown, code: "auth" | "paywall"): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === code;
}
