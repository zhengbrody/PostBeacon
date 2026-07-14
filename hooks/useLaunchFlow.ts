"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { api } from "@/lib/api";
import { clearDraft, loadDraft } from "@/lib/storage";
import { DEMO_PROJECT } from "@/lib/demo";
import { PLATFORMS } from "@/lib/platforms";
import type { ContextField } from "@/lib/facts";
import { variantDirection } from "@/lib/today";
import {
  applyActionPlan,
  applyKindOf,
  isDestructive,
  summaryOf,
  type ActionContext,
  type ApplyKind,
} from "@/lib/copilotActions";
import {
  flowReducer,
  initialFlowState,
  type LoadedProject,
  type Step,
} from "./launchFlowReducer";
import type {
  Provider,
  Experiment,
  MarketingStrategy,
  Outcome,
  PlatformPost,
  PlatformRecommendation,
  ProductProfile,
  ProposedAction,
  ScheduleItem,
  TaskRecord,
  ProviderRunMeta,
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

  // Once a fallback succeeds, make that healthy provider the primary for the
  // rest of this browser flow instead of repeatedly hitting a dead key first.
  const adoptFallback = (meta?: ProviderRunMeta) => {
    if (meta?.fallbackFrom) setProvider(meta.provider);
  };

  const analyze = () =>
    run(async () => {
      const { profile, facts, questions, meta } = await api.analyze(url, provider);
      adoptFallback(meta);
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
      adoptFallback(strategy.meta);
      dispatch({ type: "STRATEGY_BUILT", strategy });
    }, "Scanning every platform & ranking your channels…");

  const generate = () =>
    run(async () => {
      if (!profile) return;
      setPaywall(null);
      try {
        const result = await api.generate(profile, selected, provider, facts);
        adoptFallback(result.content.find((c) => c.meta?.fallbackFrom)?.meta);
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
      adoptFallback(meta);
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
        adoptFallback(meta);
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

  // Follow-up variant for an analyzed experiment: the ONLY model call in the
  // loop, on demand. Direction is built in code from the outcome data; the
  // rewrite lands as a new draft on that channel. Never auto-posts.
  const generateVariant = (experiment: Experiment) => {
    const verdict = experiment.verdict;
    if (!verdict) return Promise.resolve();
    return run(async () => {
      if (!profile || !state.strategy) return;
      const platform = PLATFORMS.find((p) => p.id === experiment.platformId);
      const res = await api.copilot({
        provider,
        profile,
        strategy: state.strategy,
        result: state.result,
        facts,
        workspace: state.workspace,
        memory: state.memory,
        launchDate: state.launchDate,
        action: "rewrite",
        targetPlatformId: experiment.platformId,
        question: variantDirection(experiment, verdict),
      });
      adoptFallback(res.meta);
      const variant = res.actions.find(
        (a) => a.tool === "generate_variant" && a.hook && a.body
      );
      if (
        !variant ||
        variant.tool !== "generate_variant" ||
        !variant.hook ||
        !variant.body
      ) {
        throw new Error("No variant came back — try again.");
      }
      dispatch({
        type: "VARIANT_ADDED",
        platformId: experiment.platformId,
        post: {
          hook: variant.hook,
          body: variant.body,
          imageSuggestion: "",
          bestTime: platform?.bestTime ?? "",
          caveats: "",
        },
        note: `Generated a follow-up variant for ${experiment.platformName}`,
      });
    }, `Writing a follow-up variant for ${experiment.platformName}…`);
  };

  // ---- Copilot action engine (M16). The ONLY bridge from a proposal to
  // ---- state, and it only runs from an explicit user confirmation.

  const actionCtx = (): ActionContext => ({
    strategy: state.strategy,
    result: state.result,
    facts: state.facts,
    workspace: state.workspace,
    memory: state.memory,
    launchDate: state.launchDate,
  });

  const audit = (
    a: ProposedAction,
    decision: "applied" | "rejected",
    destructive: boolean
  ) =>
    dispatch({
      type: "AUDIT_LOGGED",
      entry: {
        id: a.id,
        at: new Date().toISOString(),
        tool: a.tool,
        summary: summaryOf(a),
        decision,
        destructive,
        evidenceVerified: a.evidence.length,
        evidenceCited: a.evidence.length + a.droppedEvidence,
      },
    });

  /** Confirmed by the user → dispatch its plan + audit it. Returns the apply
   *  kind so the panel can open dialogs / trigger the rewrite call. */
  const applyAction = (a: ProposedAction): ApplyKind => {
    const ctx = actionCtx();
    const kind = applyKindOf(a);
    for (const action of applyActionPlan(a, ctx)) {
      dispatch(
        action.type === "STRATEGY_PATCHED" ||
          action.type === "RECOMMENDATION_PATCHED" ||
          action.type === "POST_PATCHED"
          ? { ...action, origin: "copilot" }
          : action
      );
    }
    if (a.tool === "generate_variant" && a.hook && a.body) {
      dispatch({
        type: "MEMORY_REWRITE_FEEDBACK",
        feedback: {
          platformId: a.platformId,
          direction: "accepted",
          summary: a.hook.slice(0, 80),
          at: new Date().toISOString(),
        },
      });
    }
    audit(a, "applied", isDestructive(a, ctx));
    return kind;
  };

  const rejectAction = (a: ProposedAction) => {
    if (a.tool === "generate_variant" && (a.hook || a.direction)) {
      dispatch({
        type: "MEMORY_REWRITE_FEEDBACK",
        feedback: {
          platformId: a.platformId,
          direction: "rejected",
          summary: (a.hook || a.direction || "variant").slice(0, 80),
          at: new Date().toISOString(),
        },
      });
    }
    audit(a, "rejected", isDestructive(a, actionCtx()));
  };

  /** Server-side blocked proposals (invalid schema / unknown ids) get one
   *  aggregate audit entry so the log shows what never reached the UI. */
  const auditBlocked = (count: number) => {
    if (count <= 0) return;
    dispatch({
      type: "AUDIT_LOGGED",
      entry: {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        tool: "unknown",
        summary: count + " invalid proposal(s) blocked by the schema validator",
        decision: "blocked",
        destructive: false,
        evidenceVerified: 0,
        evidenceCited: 0,
      },
    });
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
  // Discarding also removes the draft from this device (M17: "clear local
  // draft"). Merely hiding the banner left a zombie copy that re-offered
  // itself next visit or got silently overwritten by the next run.
  const clearLocalDraft = () => {
    clearDraft();
    setPendingDraft(null);
  };

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
      workspace: state.workspace,
      memory: state.memory,
    }),
    [
      state.url,
      state.profile,
      state.strategy,
      state.result,
      state.posted,
      state.selected,
      state.facts,
      state.workspace,
      state.memory,
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
    clearLocalDraft,
    analyze,
    buildStrategy,
    generate,
    reset: () => dispatch({ type: "RESET" }),
    loadProject,
    snapshot,
    // ---- workspace (M15) ----
    workspace: state.workspace,
    // ---- copilot action engine + memory (M16) ----
    memory: state.memory,
    applyAction,
    rejectAction,
    auditBlocked,
    setTone: (tone?: string) => dispatch({ type: "MEMORY_TONE_SET", tone }),
    addBannedClaim: (claim: string) => dispatch({ type: "MEMORY_BANNED_ADDED", claim }),
    removeBannedClaim: (idx: number) => dispatch({ type: "MEMORY_BANNED_REMOVED", idx }),
    setWeeklyMinutes: (minutes?: number) =>
      dispatch({ type: "WEEKLY_MINUTES_SET", minutes }),
    actTask: (record: TaskRecord) => dispatch({ type: "TASK_ACTED", record }),
    publishExperiment: (experiment: Experiment, taskId?: string) =>
      dispatch({ type: "EXPERIMENT_CREATED", experiment, taskId }),
    recordOutcome: (experimentId: string, outcome: Outcome) =>
      dispatch({ type: "OUTCOME_RECORDED", experimentId, outcome }),
    stopExperiment: (experimentId: string) =>
      dispatch({ type: "EXPERIMENT_STOPPED", experimentId }),
    generateVariant,
  };
}

/** Narrow an api.ts ApiError without `any`: gated 401/402s carry a code. */
function isGateError(e: unknown, code: "auth" | "paywall"): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === code;
}
