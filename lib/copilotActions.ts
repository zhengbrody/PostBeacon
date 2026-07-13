import { z } from "zod";
import { PLATFORMS } from "./platforms";
import { clipString } from "./coerce";
import type {
  EvidenceRef,
  Fact,
  GenerateResult,
  MarketingStrategy,
  Priority,
  ProductMemory,
  ProposedAction,
  ScheduleItem,
  WorkspaceState,
} from "./types";
import type { FlowAction } from "@/hooks/launchFlowReducer";

/**
 * The copilot action engine (M16). The model returns raw proposals; this
 * module is the hard boundary between them and the app:
 *
 *  - validateProposedActions: strict per-tool schemas, unknown tools dropped,
 *    ids checked against REAL plan objects, evidence re-verified in code
 *    (confidence is computed, never model-claimed).
 *  - isDestructive / impactOf: what the confirmation UI shows.
 *  - applyActionPlan: the ONLY mapping from a confirmed action to reducer
 *    dispatches. Nothing in this module dispatches anything itself — a
 *    proposal without an explicit user confirmation can never touch state.
 *
 * record_outcome deliberately has NO metric fields: a model cannot fabricate
 * numbers into an outcome; it can only point the user at the manual form.
 */

export interface ActionContext {
  strategy: MarketingStrategy | null;
  result: GenerateResult | null;
  facts: Fact[];
  workspace: WorkspaceState;
  memory: ProductMemory;
  launchDate?: string;
}

export const emptyMemory: ProductMemory = {
  bannedClaims: [],
  angles: [],
  rewriteFeedback: [],
  userEditedFields: [],
};

// ---------------------------------------------------------------------------
// Schemas (strict payloads; unknown keys stripped, unknown tools rejected)

const s = (max: number) => z.string().min(1).max(max);
const evidenceSchema = z
  .array(
    z.object({
      type: z.enum(["fact", "experiment", "recommendation", "post", "memory"]),
      id: z.string().max(120),
    })
  )
  .max(6)
  .default([]);

const validationExperimentSchema = z
  .object({
    platformId: z.string().max(64),
    community: z.string().max(200).default(""),
    angle: s(300),
    hypothesis: s(400),
  })
  .optional();

const base = {
  rationale: s(1000),
  evidence: evidenceSchema,
  validationExperiment: validationExperimentSchema,
};

const TOOL_SCHEMAS = {
  ask_clarifying_question: z.object({
    ...base,
    question: s(300),
    why: z.string().max(300).default(""),
    options: z.array(z.string().max(120)).max(4).optional(),
  }),
  propose_next_actions: z.object({
    ...base,
    items: z
      .array(
        z.object({
          title: s(200),
          whyNow: z.string().max(300).default(""),
          estMinutes: z.number().int().min(1).max(480).catch(30),
          platformId: z.string().max(64).optional(),
        })
      )
      .min(1)
      .max(3),
  }),
  update_positioning: z
    .object({
      ...base,
      positioning: z.string().min(1).max(4000).optional(),
      antiPositioning: z.string().min(1).max(4000).optional(),
    })
    .refine((v) => v.positioning || v.antiPositioning, "empty patch"),
  update_channel_priority: z.object({
    ...base,
    platformId: s(64),
    priority: z.enum(["high", "medium", "low"]),
  }),
  create_experiment: z.object({
    ...base,
    platformId: s(64),
    community: z.string().max(200).default(""),
    angle: s(300),
    hypothesis: s(400),
    postIdx: z.number().int().min(0).max(50).optional(),
  }),
  generate_variant: z.object({
    ...base,
    platformId: s(64),
    postIdx: z.number().int().min(0).max(50).optional(),
    direction: z.string().max(600).optional(),
    hook: z.string().max(2000).optional(),
    body: z.string().max(40_000).optional(),
  }),
  record_outcome: z.object({
    ...base,
    experimentId: s(80),
    checkpoint: z.enum(["24h", "72h", "manual"]),
    // NO metric fields, by design — see module doc.
  }),
  diagnose_outcome: z.object({
    ...base,
    experimentId: s(80),
    diagnosis: s(1000),
    suggestion: z.string().max(600).default(""),
  }),
  stop_or_continue_channel: z.object({
    ...base,
    platformId: s(64),
    decision: z.enum(["stop", "continue"]),
  }),
} as const;

export type KnownTool = keyof typeof TOOL_SCHEMAS;

// ---------------------------------------------------------------------------
// Evidence verification — refs must resolve to real objects.

function refResolves(ref: EvidenceRef, ctx: ActionContext): boolean {
  switch (ref.type) {
    case "fact":
      return ctx.facts.some((f) => f.id === ref.id);
    case "experiment":
      return ctx.workspace.experiments.some((e) => e.id === ref.id);
    case "recommendation":
      return !!ctx.strategy?.recommendations.some((r) => r.platformId === ref.id);
    case "post": {
      const [platformId, idxStr] = ref.id.split("#");
      const content = ctx.result?.content.find((c) => c.platformId === platformId);
      const idx = Number(idxStr);
      return !!content && Number.isInteger(idx) && idx >= 0 && idx < content.posts.length;
    }
    case "memory":
      if (ref.id === "tone") return !!ctx.memory.tone;
      if (ref.id.startsWith("banned:")) {
        return !!ctx.memory.bannedClaims[Number(ref.id.slice(7))];
      }
      if (ref.id.startsWith("angle:")) {
        return !!ctx.memory.angles[Number(ref.id.slice(6))];
      }
      return false;
  }
}

/** Per-tool referential checks beyond the schema. */
function idsResolve(a: ProposedAction, ctx: ActionContext): boolean {
  const knownPlatform = (id: string) => PLATFORMS.some((p) => p.id === id);
  const inStrategy = (id: string) =>
    !!ctx.strategy?.recommendations.some((r) => r.platformId === id);
  const hasContent = (id: string) =>
    !!ctx.result?.content.some((c) => c.platformId === id && c.posts.length > 0);
  const knownExperiment = (id: string) =>
    ctx.workspace.experiments.some((e) => e.id === id);

  switch (a.tool) {
    case "update_channel_priority":
      return inStrategy(a.platformId);
    case "create_experiment":
    case "generate_variant":
      return knownPlatform(a.platformId) && hasContent(a.platformId);
    case "record_outcome":
    case "diagnose_outcome":
      return knownExperiment(a.experimentId);
    case "stop_or_continue_channel":
      return knownPlatform(a.platformId);
    case "propose_next_actions":
      return a.items.every((i) => !i.platformId || knownPlatform(i.platformId));
    default:
      return true;
  }
}

export interface ValidationOutcome {
  actions: ProposedAction[];
  blocked: number; // unknown tools, invalid payloads, unresolved ids
}

export const MAX_ACTIONS_PER_REPLY = 5;

/** The hard boundary: raw model output → verified proposals (or nothing). */
export function validateProposedActions(
  raw: unknown,
  ctx: ActionContext
): ValidationOutcome {
  const list = Array.isArray(raw) ? raw : [];
  const actions: ProposedAction[] = [];
  let blocked = 0;

  for (const item of list) {
    if (actions.length >= MAX_ACTIONS_PER_REPLY) {
      blocked++;
      continue;
    }
    const tool = (item as { tool?: unknown })?.tool;
    if (typeof tool !== "string" || !(tool in TOOL_SCHEMAS)) {
      blocked++;
      continue;
    }
    const parsed = TOOL_SCHEMAS[tool as KnownTool].safeParse(item);
    if (!parsed.success) {
      blocked++;
      continue;
    }

    const cited = parsed.data.evidence;
    const draft = {
      id: crypto.randomUUID(),
      tool,
      ...parsed.data,
      evidence: [] as EvidenceRef[],
      droppedEvidence: 0,
      confidence: "unknown" as const,
    } as ProposedAction;

    if (!idsResolve(draft, ctx)) {
      blocked++;
      continue;
    }

    // Evidence is EARNED: refs that don't resolve are dropped and counted;
    // confidence is recomputed here, whatever the model claimed.
    const verified = cited.filter((ref) => refResolves(ref, ctx));
    const action: ProposedAction = {
      ...draft,
      evidence: verified,
      droppedEvidence: cited.length - verified.length,
      confidence: verified.length > 0 ? "grounded" : "unknown",
    };
    // A validation experiment must itself point somewhere real.
    if (
      action.validationExperiment &&
      !PLATFORMS.some((p) => p.id === action.validationExperiment!.platformId)
    ) {
      delete action.validationExperiment;
    }
    actions.push(action);
  }

  return { actions, blocked };
}

// ---------------------------------------------------------------------------
// Confirmation metadata

const PRIORITY_RANK: Record<Priority, number> = { high: 2, medium: 1, low: 0 };

/** Destructive proposals require the second confirmation. */
export function isDestructive(a: ProposedAction, ctx: ActionContext): boolean {
  switch (a.tool) {
    case "stop_or_continue_channel":
      return a.decision === "stop";
    case "update_channel_priority": {
      const current = ctx.strategy?.recommendations.find(
        (r) => r.platformId === a.platformId
      )?.priority;
      return !!current && PRIORITY_RANK[a.priority] < PRIORITY_RANK[current];
    }
    case "update_positioning":
      return (
        (!!a.positioning && ctx.memory.userEditedFields.includes("positioning")) ||
        (!!a.antiPositioning && ctx.memory.userEditedFields.includes("antiPositioning"))
      );
    default:
      return false;
  }
}

/** One plain-language line about what Apply actually does. */
export function impactOf(a: ProposedAction, ctx: ActionContext): string {
  switch (a.tool) {
    case "ask_clarifying_question":
      return "No change — answering feeds the conversation.";
    case "propose_next_actions":
      return `Adds ${a.items.length} step${a.items.length > 1 ? "s" : ""} to your launch calendar. Nothing is posted.`;
    case "update_positioning": {
      const edited = isDestructive(a, ctx) ? " Overwrites a line you edited by hand." : "";
      return `Rewrites the positioning used across the plan, exports, and future content.${edited}`;
    }
    case "update_channel_priority": {
      const rec = ctx.strategy?.recommendations.find((r) => r.platformId === a.platformId);
      const from = rec ? `${rec.priority} → ` : "";
      return `${rec?.platformName ?? a.platformId}: ${from}${a.priority}. Score (${rec?.score ?? "—"}) and drafts stay untouched.`;
    }
    case "create_experiment":
      return "Opens the publish dialog prefilled. Nothing is tracked until you confirm you published it yourself.";
    case "generate_variant":
      return a.hook && a.body
        ? "Adds this as a new draft variant — existing drafts stay untouched."
        : "Writes one new draft variant (one model call). Existing drafts stay untouched.";
    case "record_outcome":
      return "Opens the outcome form for manual entry — numbers are never filled in for you.";
    case "diagnose_outcome":
      return "No change — a read on the recorded results.";
    case "stop_or_continue_channel": {
      if (a.decision === "continue") return "No change — an endorsement to keep going.";
      const live = ctx.workspace.experiments.filter(
        (e) => e.platformId === a.platformId && e.status !== "stopped"
      ).length;
      return `Stops ${live} experiment${live === 1 ? "" : "s"} on this channel; its check-ins leave Today. Drafts are kept.`;
    }
  }
}

/** Short label for audit entries / the timeline. */
export function summaryOf(a: ProposedAction): string {
  switch (a.tool) {
    case "ask_clarifying_question":
      return `Asked: ${clipString(a.question, 60)}`;
    case "propose_next_actions":
      return `Proposed ${a.items.length} next step(s)`;
    case "update_positioning":
      return "Update positioning";
    case "update_channel_priority":
      return `Set ${a.platformId} priority → ${a.priority}`;
    case "create_experiment":
      return `Prepare experiment on ${a.platformId}${a.community ? ` (${a.community})` : ""}`;
    case "generate_variant":
      return `Variant for ${a.platformId}`;
    case "record_outcome":
      return `Record ${a.checkpoint} results`;
    case "diagnose_outcome":
      return `Diagnosis: ${clipString(a.diagnosis, 60)}`;
    case "stop_or_continue_channel":
      return `${a.decision === "stop" ? "Stop" : "Continue"} ${a.platformId}`;
  }
}

// ---------------------------------------------------------------------------
// Apply mapping — the ONLY proposal → state bridge, used on explicit confirm.

export type ApplyKind =
  | "dispatch" // maps directly to reducer actions (returned below)
  | "open-publish" // create_experiment → prefilled publish dialog
  | "open-outcome" // record_outcome → outcome form
  | "rewrite-call" // generate_variant without content → one model call
  | "none"; // informational

export function applyKindOf(a: ProposedAction): ApplyKind {
  switch (a.tool) {
    case "update_positioning":
    case "update_channel_priority":
    case "propose_next_actions":
      return "dispatch";
    case "stop_or_continue_channel":
      return a.decision === "stop" ? "dispatch" : "none";
    case "generate_variant":
      return a.hook && a.body ? "dispatch" : "rewrite-call";
    case "create_experiment":
      return "open-publish";
    case "record_outcome":
      return "open-outcome";
    default:
      return "none";
  }
}

/** Reducer dispatches for a CONFIRMED "dispatch"-kind action. Pure. */
export function applyActionPlan(a: ProposedAction, ctx: ActionContext): FlowAction[] {
  switch (a.tool) {
    case "update_positioning": {
      const patch: { positioning?: string; antiPositioning?: string } = {};
      if (a.positioning) patch.positioning = a.positioning;
      if (a.antiPositioning) patch.antiPositioning = a.antiPositioning;
      return [{ type: "STRATEGY_PATCHED", patch }];
    }
    case "update_channel_priority":
      return [
        {
          type: "RECOMMENDATION_PATCHED",
          platformId: a.platformId,
          patch: { priority: a.priority },
        },
      ];
    case "stop_or_continue_channel": {
      if (a.decision !== "stop") return [];
      return ctx.workspace.experiments
        .filter((e) => e.platformId === a.platformId && e.status !== "stopped")
        .map((e) => ({ type: "EXPERIMENT_STOPPED" as const, experimentId: e.id }));
    }
    case "generate_variant": {
      if (!a.hook || !a.body) return [];
      const platform = PLATFORMS.find((p) => p.id === a.platformId);
      return [
        {
          type: "VARIANT_ADDED",
          platformId: a.platformId,
          post: {
            hook: a.hook,
            body: a.body,
            imageSuggestion: "",
            bestTime: platform?.bestTime ?? "",
            caveats: "",
          },
          note: `Applied copilot variant for ${platform?.name ?? a.platformId}`,
        },
      ];
    }
    case "propose_next_actions": {
      const day = currentPlanDay(ctx.launchDate);
      return a.items.map((item) => ({
        type: "SCHEDULE_ITEM_ADDED" as const,
        item: {
          day,
          platformId: item.platformId ?? "custom",
          platformName: PLATFORMS.find((p) => p.id === item.platformId)?.name ?? "Custom",
          action: item.title,
        } satisfies ScheduleItem,
      }));
    }
    default:
      return [];
  }
}

function currentPlanDay(launchDate?: string): number {
  if (!launchDate) return 1;
  const base = new Date(launchDate + "T00:00:00").getTime();
  if (isNaN(base)) return 1;
  return Math.max(1, Math.floor((Date.now() - base) / 86_400_000) + 1);
}
