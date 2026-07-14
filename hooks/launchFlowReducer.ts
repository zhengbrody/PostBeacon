import { PLATFORMS } from "@/lib/platforms";
import {
  answerFact,
  applyFactToProfile,
  confirmFact,
  correctFact,
  type ContextField,
} from "@/lib/facts";
import { orderByRecommendation, scheduleEntryFor, sortSchedule } from "@/lib/plan";
import { verdictFor } from "@/lib/today";
import type {
  AuditEntry,
  ClarifyingQuestion,
  Experiment,
  Fact,
  GenerateResult,
  GenerationMeta,
  MarketingStrategy,
  Outcome,
  PlatformPlaybook,
  PlatformPost,
  PlatformRecommendation,
  ProductMemory,
  ProductProfile,
  RewriteFeedback,
  ScheduleItem,
  TaskRecord,
  WorkspaceState,
} from "@/lib/types";

/**
 * The launch flow as an explicit state machine. Every plan mutation goes
 * through this pure reducer, and `normalize()` re-establishes the invariants
 * after EVERY action, so contradictory states (a result without its strategy,
 * a selection referencing channels that no longer exist, posted marks for
 * removed content, a step with no data behind it) are impossible by
 * construction — not by every call site remembering to clean up.
 */

export type Step = "input" | "profile" | "strategy" | "results";

export interface FlowState {
  step: Step;
  url: string;
  profile: ProductProfile | null;
  facts: Fact[];
  questions: ClarifyingQuestion[];
  strategy: MarketingStrategy | null;
  selected: string[]; // channels checked for generation (⊆ strategy recs)
  result: GenerateResult | null;
  posted: Record<string, boolean>; // `${platformId}-${postIdx}` → done
  launchDate: string;
  projectId: string; // stable id for autosave upsert
  demo: boolean; // viewing the baked-in example (autosave paused)
  workspace: WorkspaceState; // M15 — experiments, task log, weekly budget
  memory: ProductMemory; // M16 — lean product memory (never the chat transcript)
}

export const emptyWorkspace: WorkspaceState = {
  reminderPreferences: { email: false, updatedAt: "" },
  experiments: [],
  taskLog: [],
  auditLog: [],
};

export const emptyMemory: ProductMemory = {
  bannedClaims: [],
  angles: [],
  rewriteFeedback: [],
  userEditedFields: [],
};

const MEMORY_CAPS = { bannedClaims: 20, angles: 20, rewriteFeedback: 30, edits: 40 };
const AUDIT_CAP = 100;

export const initialFlowState: FlowState = {
  step: "input",
  url: "",
  profile: null,
  facts: [],
  questions: [],
  strategy: null,
  selected: [],
  result: null,
  posted: {},
  launchDate: "",
  projectId: "",
  demo: false,
  workspace: emptyWorkspace,
  memory: emptyMemory,
};

/** Payload for one channel's freshly generated content (regenerate/add/retry). */
interface ChannelPayload {
  platformId: string;
  posts: PlatformPost[];
  playbook?: PlatformPlaybook;
  meta?: GenerationMeta;
}

/** A saved project/draft in any historical shape (see lib/storage.ts). */
export interface LoadedProject {
  id?: string;
  url?: string;
  profile?: ProductProfile | null;
  strategy?: MarketingStrategy | null;
  result?: GenerateResult | null;
  posted?: Record<string, boolean>;
  selected?: string[];
  launchDate?: string;
  facts?: Fact[];
  workspace?: WorkspaceState;
  memory?: ProductMemory;
  meta?: {
    selected?: string[];
    launchDate?: string;
    facts?: Fact[];
    workspace?: WorkspaceState;
    memory?: ProductMemory;
  } | null;
}

export type FlowAction =
  | { type: "RESET" }
  | { type: "URL_SET"; url: string }
  | { type: "STEP_SET"; step: Step }
  | { type: "PROJECT_LOADED"; project: LoadedProject; demo: boolean }
  | {
      type: "ANALYZED";
      profile: ProductProfile;
      facts: Fact[];
      questions: ClarifyingQuestion[];
    }
  | { type: "PROFILE_SET"; profile: ProductProfile }
  | { type: "FACT_CONFIRMED"; id: string }
  | { type: "FACT_CORRECTED"; id: string; claim: string }
  | { type: "FACT_DELETED"; id: string }
  | { type: "QUESTION_ANSWERED"; id: ContextField; answer: string }
  | { type: "STRATEGY_BUILT"; strategy: MarketingStrategy }
  | {
      type: "STRATEGY_PATCHED";
      patch: Partial<MarketingStrategy>;
      origin?: "user" | "copilot";
    }
  | {
      type: "RECOMMENDATION_PATCHED";
      platformId: string;
      patch: Partial<PlatformRecommendation>;
      origin?: "user" | "copilot";
    }
  | { type: "SELECTION_TOGGLED"; platformId: string }
  | { type: "GENERATED"; result: GenerateResult }
  | { type: "CHANNEL_CONTENT_REPLACED"; channel: ChannelPayload }
  | { type: "CHANNEL_UPSERTED"; channel: ChannelPayload } // add-channel + retry-failed
  | { type: "CHANNEL_REMOVED"; platformId: string }
  | {
      type: "POST_PATCHED";
      platformId: string;
      idx: number;
      patch: Partial<PlatformPost>;
      origin?: "user" | "copilot";
    }
  | { type: "SCHEDULE_ITEM_PATCHED"; idx: number; patch: Partial<ScheduleItem> }
  | { type: "SCHEDULE_ITEM_REMOVED"; idx: number }
  | { type: "SCHEDULE_ITEM_ADDED"; item: ScheduleItem }
  | { type: "POSTED_TOGGLED"; id: string }
  | { type: "LAUNCH_DATE_SET"; date: string }
  | { type: "PROJECT_ID_SET"; id: string }
  // ---- workspace (M15) ----
  | { type: "WEEKLY_MINUTES_SET"; minutes?: number }
  | { type: "EMAIL_REMINDERS_SET"; enabled: boolean; timezone?: string; at: string }
  | { type: "TASK_ACTED"; record: TaskRecord }
  | { type: "EXPERIMENT_CREATED"; experiment: Experiment; taskId?: string }
  | { type: "OUTCOME_RECORDED"; experimentId: string; outcome: Outcome }
  | { type: "EXPERIMENT_STOPPED"; experimentId: string }
  | { type: "VARIANT_ADDED"; platformId: string; post: PlatformPost; note: string }
  // ---- memory + audit (M16) ----
  | { type: "MEMORY_TONE_SET"; tone?: string }
  | { type: "MEMORY_BANNED_ADDED"; claim: string }
  | { type: "MEMORY_BANNED_REMOVED"; idx: number }
  | { type: "MEMORY_REWRITE_FEEDBACK"; feedback: RewriteFeedback }
  | { type: "AUDIT_LOGGED"; entry: AuditEntry };

// Default channel set: the 4 best-scoring recommendations. A tight default —
// content is only written for checked channels, and a focused plan beats a
// sprawling one. Sorted explicitly; the model's array order isn't trusted.
export function defaultSelection(recs?: PlatformRecommendation[]): string[] {
  if (!recs?.length) return [];
  return [...recs]
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((r) => r.platformId);
}

/** The deepest step the state has data for. */
function deepestStep(s: FlowState): Step {
  if (s.result) return "results";
  if (s.strategy) return "strategy";
  if (s.profile) return "profile";
  return "input";
}

const STEP_ORDER: Step[] = ["input", "profile", "strategy", "results"];

/**
 * Re-establish every invariant. Called on the result of each transition:
 *  1. no profile  ⇒ no facts/questions/strategy (and everything below)
 *  2. no strategy ⇒ no selection, no result (and everything below)
 *  3. selection   ⊆ strategy's channels
 *  4. no result   ⇒ no posted marks
 *  5. posted marks ⇒ only for posts that exist in result content
 *  6. step        ⇒ never deeper than the data supports
 */
export function normalize(s: FlowState): FlowState {
  let next = s;
  if (!next.profile && (next.facts.length || next.questions.length || next.strategy)) {
    next = { ...next, facts: [], questions: [], strategy: null };
  }
  if (!next.strategy && (next.selected.length || next.result)) {
    next = { ...next, selected: [], result: null };
  }
  if (next.strategy && next.selected.length) {
    const known = new Set(next.strategy.recommendations.map((r) => r.platformId));
    const kept = next.selected.filter((id) => known.has(id));
    if (kept.length !== next.selected.length) next = { ...next, selected: kept };
  }
  if (!next.result && Object.keys(next.posted).length) {
    next = { ...next, posted: {} };
  }
  if (
    !next.result &&
    (next.workspace.experiments.length || next.workspace.taskLog.length)
  ) {
    // No generated plan ⇒ no workspace history (fresh analyze / rebuilt
    // strategy start a fresh campaign; per-channel edits never clear this).
    next = { ...next, workspace: { ...next.workspace, experiments: [], taskLog: [] } };
  }
  if (next.result && Object.keys(next.posted).length) {
    const valid = new Set(
      next.result.content.flatMap((c) => c.posts.map((_, i) => `${c.platformId}-${i}`))
    );
    const entries = Object.entries(next.posted).filter(([k]) => valid.has(k));
    if (entries.length !== Object.keys(next.posted).length) {
      next = { ...next, posted: Object.fromEntries(entries) };
    }
  }
  const deepest = deepestStep(next);
  if (STEP_ORDER.indexOf(next.step) > STEP_ORDER.indexOf(deepest)) {
    next = { ...next, step: deepest };
  }
  return next;
}

/** Remember hand-edited plan fields (drives the copilot overwrite confirm). */
function withUserEdits(s: FlowState, fields: string[]): FlowState {
  const merged = Array.from(new Set([...s.memory.userEditedFields, ...fields])).slice(
    -MEMORY_CAPS.edits
  );
  return { ...s, memory: { ...s.memory, userEditedFields: merged } };
}

function transition(s: FlowState, a: FlowAction): FlowState {
  switch (a.type) {
    case "RESET":
      return initialFlowState;

    case "URL_SET":
      return { ...s, url: a.url };

    case "STEP_SET":
      // normalize() clamps to the deepest step the data supports.
      return { ...s, step: a.step };

    case "PROJECT_LOADED": {
      const p = a.project;
      return {
        step: "input", // normalize derives the real step via the clamp below
        url: p.url || "",
        profile: p.profile || null,
        strategy: p.strategy || null,
        result: p.result || null,
        posted: p.posted || {},
        launchDate: p.launchDate || p.meta?.launchDate || "",
        projectId: p.id || "",
        // Facts: flat field (local draft) or meta (Supabase row); pre-M13
        // saves have neither → empty ledger.
        facts: p.facts ?? p.meta?.facts ?? [],
        questions: [], // questions are an analyze-time artifact, not persisted
        // Three generations of saved data: flat `selected`, `meta`, or neither
        // (pre-M11) → derive a fresh default.
        selected:
          p.selected ?? p.meta?.selected ?? defaultSelection(p.strategy?.recommendations),
        // Workspace: flat field (local draft v4) or meta (Supabase row);
        // pre-M15 saves have neither → empty loop history.
        workspace: {
          ...emptyWorkspace,
          ...(p.workspace ?? p.meta?.workspace ?? {}),
        },
        // Memory: v5 flat field or meta; pre-M16 saves → empty memory.
        memory: p.memory ?? p.meta?.memory ?? emptyMemory,
        demo: a.demo,
        // Open at the deepest step the loaded data supports.
        ...(p.result
          ? { step: "results" as Step }
          : p.strategy
            ? { step: "strategy" as Step }
            : p.profile
              ? { step: "profile" as Step }
              : {}),
      };
    }

    case "ANALYZED":
      // A fresh analysis starts a fresh plan: anything derived from the
      // previous product (strategy/result/selection/marks) is stale by
      // definition and dropped, so steps 3-4 can never show the old product.
      return {
        ...s,
        demo: false,
        profile: a.profile,
        facts: a.facts,
        questions: a.questions,
        strategy: null,
        selected: [],
        result: null,
        posted: {},
        workspace: {
          ...emptyWorkspace,
          weeklyMinutes: s.workspace.weeklyMinutes,
          reminderPreferences: s.workspace.reminderPreferences,
        },
        // Tone + banned claims are durable preferences; angle verdicts,
        // rewrite feedback and edit tracking belong to the old plan.
        memory: {
          ...emptyMemory,
          tone: s.memory.tone,
          bannedClaims: s.memory.bannedClaims,
        },
        step: "profile",
      };

    case "PROFILE_SET":
      return { ...s, profile: a.profile };

    case "FACT_CONFIRMED":
      return {
        ...s,
        facts: s.facts.map((f) => (f.id === a.id ? confirmFact(f) : f)),
      };

    case "FACT_CORRECTED": {
      const target = s.facts.find((f) => f.id === a.id);
      if (!target) return s;
      const fixed = correctFact(target, a.claim);
      return {
        ...s,
        facts: s.facts.map((f) => (f.id === a.id ? fixed : f)),
        // Correcting a fact also syncs the profile field it backs, so the
        // ledger and the form never disagree.
        profile: s.profile ? applyFactToProfile(s.profile, fixed) : s.profile,
      };
    }

    case "FACT_DELETED":
      return { ...s, facts: s.facts.filter((f) => f.id !== a.id) };

    case "QUESTION_ANSWERED": {
      const trimmed = a.answer.trim();
      const remaining = s.questions.filter((q) => q.id !== a.id);
      if (!trimmed) return { ...s, questions: remaining }; // skip = honest unknown
      const fact = answerFact(a.id, trimmed);
      return {
        ...s,
        questions: remaining,
        facts: [...s.facts.filter((f) => f.id !== a.id), fact],
        profile: s.profile ? applyFactToProfile(s.profile, fact) : s.profile,
      };
    }

    case "STRATEGY_BUILT":
      // A rebuilt strategy invalidates content generated under the old one.
      return {
        ...s,
        strategy: a.strategy,
        selected: defaultSelection(a.strategy.recommendations),
        result: null,
        posted: {},
        step: "strategy",
      };

    case "STRATEGY_PATCHED": {
      if (!s.strategy) return s;
      const next = { ...s, strategy: { ...s.strategy, ...a.patch } };
      if (a.origin === "copilot") return next;
      // Hand edits are remembered so a copilot overwrite needs double confirm.
      const edited: string[] = [];
      if ("positioning" in a.patch) edited.push("positioning");
      if ("antiPositioning" in a.patch) edited.push("antiPositioning");
      return edited.length ? withUserEdits(next, edited) : next;
    }

    case "RECOMMENDATION_PATCHED": {
      if (!s.strategy) return s;
      const next = {
        ...s,
        strategy: {
          ...s.strategy,
          recommendations: s.strategy.recommendations.map((r) =>
            r.platformId === a.platformId ? { ...r, ...a.patch } : r
          ),
        },
      };
      if (a.origin === "copilot") return next;
      const edited: string[] = [];
      if ("angle" in a.patch) edited.push("angle:" + a.platformId);
      if ("bestMove" in a.patch) edited.push("bestMove:" + a.platformId);
      return edited.length ? withUserEdits(next, edited) : next;
    }

    case "SELECTION_TOGGLED": {
      if (!s.strategy?.recommendations.some((r) => r.platformId === a.platformId)) {
        return s; // can't select a channel the strategy doesn't know
      }
      return {
        ...s,
        selected: s.selected.includes(a.platformId)
          ? s.selected.filter((x) => x !== a.platformId)
          : [...s.selected, a.platformId],
      };
    }

    case "GENERATED":
      return { ...s, result: a.result, step: "results" };

    case "CHANNEL_CONTENT_REPLACED":
      return s.result
        ? {
            ...s,
            result: {
              ...s.result,
              content: s.result.content.map((c) =>
                c.platformId === a.channel.platformId
                  ? {
                      ...c,
                      posts: a.channel.posts,
                      playbook: a.channel.playbook ?? c.playbook,
                      meta: a.channel.meta ?? c.meta,
                    }
                  : c
              ),
            },
          }
        : s;

    case "CHANNEL_UPSERTED": {
      // Write content for one more channel (or retry a failed one), slotting
      // it into the plan at its ranked position — content order, calendar,
      // selection and the failure list move together.
      const platform = PLATFORMS.find((p) => p.id === a.channel.platformId);
      if (!s.result || !platform) return s;
      const block = {
        platformId: platform.id,
        platformName: platform.name,
        posts: a.channel.posts,
        playbook: a.channel.playbook,
        meta: a.channel.meta,
      };
      return {
        ...s,
        result: {
          ...s.result,
          content: orderByRecommendation(
            [...s.result.content.filter((c) => c.platformId !== platform.id), block],
            s.strategy?.recommendations
          ),
          schedule: sortSchedule([
            ...s.result.schedule.filter((x) => x.platformId !== platform.id),
            scheduleEntryFor(platform),
          ]),
          failures: (s.result.failures ?? []).filter((f) => f.platformId !== platform.id),
        },
        selected: s.selected.includes(platform.id)
          ? s.selected
          : [...s.selected, platform.id],
      };
    }

    case "CHANNEL_REMOVED":
      // Content, calendar steps, posted marks and the generation set go
      // together so counts and re-generates never drift.
      return {
        ...s,
        result: s.result
          ? {
              ...s.result,
              content: s.result.content.filter((c) => c.platformId !== a.platformId),
              schedule: s.result.schedule.filter((x) => x.platformId !== a.platformId),
            }
          : s.result,
        selected: s.selected.filter((x) => x !== a.platformId),
        // posted marks for the removed channel are pruned by normalize()
      };

    case "POST_PATCHED":
      if (s.result && a.origin !== "copilot") {
        s = withUserEdits(s, ["post:" + a.platformId + "#" + a.idx]);
      }
      return s.result
        ? {
            ...s,
            result: {
              ...s.result,
              content: s.result.content.map((c) =>
                c.platformId === a.platformId
                  ? {
                      ...c,
                      posts: c.posts.map((p, i) =>
                        i === a.idx ? { ...p, ...a.patch } : p
                      ),
                    }
                  : c
              ),
            },
          }
        : s;

    case "SCHEDULE_ITEM_PATCHED":
      // Re-sort by day inside the transition, so the render and the next
      // index-based edit always see the same order.
      return s.result
        ? {
            ...s,
            result: {
              ...s.result,
              schedule: sortSchedule(
                s.result.schedule.map((x, i) => (i === a.idx ? { ...x, ...a.patch } : x))
              ),
            },
          }
        : s;

    case "SCHEDULE_ITEM_REMOVED":
      return s.result
        ? {
            ...s,
            result: {
              ...s.result,
              schedule: s.result.schedule.filter((_, i) => i !== a.idx),
            },
          }
        : s;

    case "SCHEDULE_ITEM_ADDED":
      return s.result
        ? {
            ...s,
            result: { ...s.result, schedule: sortSchedule([...s.result.schedule, a.item]) },
          }
        : s;

    case "POSTED_TOGGLED":
      return { ...s, posted: { ...s.posted, [a.id]: !s.posted[a.id] } };

    case "LAUNCH_DATE_SET":
      return { ...s, launchDate: a.date };

    case "PROJECT_ID_SET":
      return { ...s, projectId: a.id };

    // ---- memory + audit (M16) ----

    case "MEMORY_TONE_SET":
      return { ...s, memory: { ...s.memory, tone: a.tone?.trim() || undefined } };

    case "MEMORY_BANNED_ADDED": {
      const claim = a.claim.trim().slice(0, 200);
      if (!claim || s.memory.bannedClaims.includes(claim)) return s;
      return {
        ...s,
        memory: {
          ...s.memory,
          bannedClaims: [...s.memory.bannedClaims, claim].slice(-MEMORY_CAPS.bannedClaims),
        },
      };
    }

    case "MEMORY_BANNED_REMOVED":
      return {
        ...s,
        memory: {
          ...s.memory,
          bannedClaims: s.memory.bannedClaims.filter((_, i) => i !== a.idx),
        },
      };

    case "MEMORY_REWRITE_FEEDBACK":
      return {
        ...s,
        memory: {
          ...s.memory,
          rewriteFeedback: [...s.memory.rewriteFeedback, a.feedback].slice(
            -MEMORY_CAPS.rewriteFeedback
          ),
        },
      };

    case "AUDIT_LOGGED":
      return {
        ...s,
        workspace: {
          ...s.workspace,
          auditLog: [...(s.workspace.auditLog ?? []), a.entry].slice(-AUDIT_CAP),
        },
      };

    // ---- workspace (M15) ----

    case "WEEKLY_MINUTES_SET":
      return { ...s, workspace: { ...s.workspace, weeklyMinutes: a.minutes } };

    case "EMAIL_REMINDERS_SET":
      return {
        ...s,
        workspace: {
          ...s.workspace,
          reminderPreferences: {
            email: a.enabled,
            timezone: a.timezone,
            updatedAt: a.at,
          },
        },
      };

    case "TASK_ACTED":
      // One record per card id — acting twice replaces (idempotent).
      return {
        ...s,
        workspace: {
          ...s.workspace,
          taskLog: [...s.workspace.taskLog.filter((t) => t.id !== a.record.id), a.record],
        },
      };

    case "EXPERIMENT_CREATED": {
      // Publishing by hand: the experiment starts the loop, the draft is
      // marked posted, and the Today card (if any) is logged done — one
      // transition so they can never drift apart.
      const taskLog = a.taskId
        ? [
            ...s.workspace.taskLog.filter((t) => t.id !== a.taskId),
            {
              id: a.taskId,
              kind: "post" as const,
              title: `Post to ${a.experiment.platformName}`,
              status: "done" as const,
              estMinutes: 0,
              at: a.experiment.publishedAt,
            },
          ]
        : s.workspace.taskLog;
      return {
        ...s,
        posted: {
          ...s.posted,
          [`${a.experiment.platformId}-${a.experiment.postIdx}`]: true,
        },
        workspace: {
          ...s.workspace,
          experiments: [...s.workspace.experiments, a.experiment],
          taskLog,
        },
      };
    }

    case "OUTCOME_RECORDED": {
      // Verdict is computed HERE, deterministically — recording results and
      // getting the read are one atomic step (a completed learning loop).
      const target = s.workspace.experiments.find((e) => e.id === a.experimentId);
      if (!target) return s;
      const verdict = verdictFor(a.outcome, {
        platformName: target.platformName,
        angle: target.angle,
        goal: s.profile?.conversionGoal,
      });
      // Product memory learns which angles win or lose, citing the experiment.
      // no-signal at 24h means "too early", not a loss.
      const angleVerdict =
        verdict.call === "supported" || verdict.call === "promising"
          ? ("winning" as const)
          : verdict.call === "weak" || a.outcome.checkpoint === "72h"
            ? ("losing" as const)
            : null;
      const angles = angleVerdict
        ? [
            ...s.memory.angles,
            {
              angle: target.angle,
              platformId: target.platformId,
              verdict: angleVerdict,
              experimentId: target.id,
              at: a.outcome.recordedAt,
            },
          ].slice(-MEMORY_CAPS.angles)
        : s.memory.angles;
      return {
        ...s,
        memory: { ...s.memory, angles },
        workspace: {
          ...s.workspace,
          experiments: s.workspace.experiments.map((e) =>
            e.id !== a.experimentId
              ? e
              : {
                  ...e,
                  outcomes: [...e.outcomes, a.outcome],
                  verdict,
                  status: e.status === "stopped" ? e.status : ("analyzed" as const),
                }
          ),
        },
      };
    }

    case "EXPERIMENT_STOPPED":
      return {
        ...s,
        workspace: {
          ...s.workspace,
          experiments: s.workspace.experiments.map((e) =>
            e.id === a.experimentId ? { ...e, status: "stopped" as const } : e
          ),
        },
      };

    case "VARIANT_ADDED":
      // Append the follow-up variant as a new draft on that channel, and log
      // it so the timeline shows the loop continuing.
      if (!s.result) return s;
      return {
        ...s,
        result: {
          ...s.result,
          content: s.result.content.map((c) =>
            c.platformId === a.platformId ? { ...c, posts: [...c.posts, a.post] } : c
          ),
        },
        workspace: {
          ...s.workspace,
          taskLog: [
            ...s.workspace.taskLog,
            {
              id: `variant:${a.platformId}:${Date.now()}`,
              kind: "custom",
              title: a.note,
              status: "done",
              estMinutes: 0,
              at: new Date().toISOString(),
            },
          ],
        },
      };
  }
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  return normalize(transition(state, action));
}
