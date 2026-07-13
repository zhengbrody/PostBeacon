import { PLATFORMS } from "./platforms";
import { clipString } from "./coerce";
import type {
  Experiment,
  ExperimentVerdict,
  GenerateResult,
  MarketingStrategy,
  Outcome,
  OutcomeCheckpoint,
  TaskRecord,
  VerdictCall,
  WorkspaceState,
} from "./types";

/**
 * The workspace engine. Everything here is a pure derivation over plan +
 * workspace state — Today cards are never stored, verdicts are rule-based and
 * explainable (same trust posture as M13 scoring: the model writes copy,
 * never judgments), and the north star is computed, not counted by hand.
 */

// ---------------------------------------------------------------------------
// Today derivation (≤3 action cards)

export const MAX_TODAY_ACTIONS = 3;
export const RECORD_MINUTES = 5;
const EFFORT_MINUTES: Record<"low" | "medium" | "high", number> = {
  low: 20,
  medium: 45,
  high: 90,
};
const CUSTOM_MINUTES = 15;

export interface TodayAction {
  id: string; // stable across renders — TaskRecord references it
  kind: "record" | "post" | "custom" | "review";
  title: string;
  whyNow: string;
  estMinutes: number;
  due: boolean; // false = shown as "up next"
  platformId?: string;
  experimentId?: string;
  checkpoint?: Extract<OutcomeCheckpoint, "24h" | "72h">;
}

export interface TodayView {
  actions: TodayAction[];
  dueRecordCount: number; // nav badge: check-ins waiting
  plannedMinutes: number; // sum of shown due actions
  weeklyMinutes?: number;
}

const HOUR = 3_600_000;

/** Check-ins that are due and unrecorded for a live/analyzed experiment. */
export function dueCheckpoints(exp: Experiment, now: Date): ("24h" | "72h")[] {
  if (exp.status === "stopped") return [];
  const age = now.getTime() - new Date(exp.publishedAt).getTime();
  const has = (cp: OutcomeCheckpoint) => exp.outcomes.some((o) => o.checkpoint === cp);
  const due: ("24h" | "72h")[] = [];
  if (age >= 24 * HOUR && !has("24h")) due.push("24h");
  if (age >= 72 * HOUR && !has("72h")) due.push("72h");
  return due;
}

/** Days since launch day (day 1 = launch day itself); null without a date. */
function planDay(launchDate: string | undefined, now: Date): number | null {
  if (!launchDate) return null;
  const base = new Date(launchDate + "T00:00:00");
  if (isNaN(base.getTime())) return null;
  return Math.floor((now.getTime() - base.getTime()) / (24 * HOUR)) + 1;
}

const hoursAgo = (iso: string, now: Date) =>
  Math.max(1, Math.round((now.getTime() - new Date(iso).getTime()) / HOUR));

interface PlanSlice {
  launchDate?: string;
  strategy: MarketingStrategy | null;
  result: GenerateResult | null;
  workspace: WorkspaceState;
}

export function deriveToday(plan: PlanSlice, now: Date): TodayView {
  const { result, strategy, workspace } = plan;
  const acted = new Set(workspace.taskLog.map((t) => t.id));
  const actions: TodayAction[] = [];

  // 1. Due check-ins first — the loop only closes when results come back.
  const records = workspace.experiments
    .flatMap((exp) =>
      dueCheckpoints(exp, now).map((cp) => ({
        exp,
        cp,
        dueAt: new Date(exp.publishedAt).getTime() + (cp === "24h" ? 24 : 72) * HOUR,
      }))
    )
    .filter(({ exp, cp }) => !acted.has(`record:${exp.id}:${cp}`))
    .sort((a, b) => a.dueAt - b.dueAt);
  for (const { exp, cp } of records) {
    actions.push({
      id: `record:${exp.id}:${cp}`,
      kind: "record",
      title: `Record ${cp} results — ${exp.platformName}`,
      whyNow: `Published ${hoursAgo(exp.publishedAt, now)}h ago${
        exp.community ? ` in ${exp.community}` : ""
      } — the ${cp} signal window is the read that decides your next move.`,
      estMinutes: RECORD_MINUTES,
      due: true,
      platformId: exp.platformId,
      experimentId: exp.id,
      checkpoint: cp,
    });
  }

  // 2. Posting actions from the calendar, in schedule order.
  const day = planDay(plan.launchDate, now);
  const published = new Set(
    workspace.experiments.map((e) => `${e.platformId}`) // one live post-task per channel
  );
  const recFor = (platformId: string) =>
    strategy?.recommendations.find((r) => r.platformId === platformId);
  const upcoming: TodayAction[] = [];

  for (const item of result?.schedule ?? []) {
    const isCustom = !PLATFORMS.some((p) => p.id === item.platformId);
    const id = isCustom
      ? `custom:${item.day}:${clipString(item.action, 24)}`
      : `post:${item.platformId}`;
    if (acted.has(id)) continue;
    if (!isCustom && published.has(item.platformId)) continue;
    if (
      !isCustom &&
      !result?.content.some((c) => c.platformId === item.platformId && c.posts.length)
    ) {
      continue; // nothing drafted to post
    }
    const due = day === null ? true : item.day <= day;
    const rec = recFor(item.platformId);
    const platform = PLATFORMS.find((p) => p.id === item.platformId);
    const action: TodayAction = {
      id,
      kind: isCustom ? "custom" : "post",
      title: isCustom ? item.action : `Post to ${item.platformName}`,
      whyNow: due
        ? `Day ${item.day} of your plan${day !== null ? ` (today is day ${day})` : ""}.${
            rec?.bestMove ? ` ${clipString(rec.bestMove, 140)}` : ""
          }`
        : `Coming up: day ${item.day} of your plan.`,
      estMinutes: isCustom ? CUSTOM_MINUTES : EFFORT_MINUTES[platform?.effort ?? "medium"],
      due,
      platformId: isCustom ? undefined : item.platformId,
    };
    if (due) actions.push(action);
    else upcoming.push(action);
    if (actions.length >= MAX_TODAY_ACTIONS) break;
  }

  // 3. Fill with what's next, or point at the review when all caught up.
  for (const u of upcoming) {
    if (actions.length >= MAX_TODAY_ACTIONS) break;
    actions.push(u);
  }
  if (actions.length === 0) {
    actions.push({
      id: "review:week",
      kind: "review",
      title: "All caught up — read your weekly review",
      whyNow:
        "Every planned post is out and every check-in is recorded. The review shows what your loops learned this week.",
      estMinutes: RECORD_MINUTES,
      due: false,
    });
  }

  const shown = actions.slice(0, MAX_TODAY_ACTIONS);
  return {
    actions: shown,
    dueRecordCount: records.length,
    plannedMinutes: shown.filter((a) => a.due).reduce((n, a) => n + a.estMinutes, 0),
    weeklyMinutes: workspace.weeklyMinutes,
  };
}

// ---------------------------------------------------------------------------
// Verdicts — rule-based, explainable, computed the moment outcomes land.

const num = (v: number | undefined) => (typeof v === "number" ? v : null);

export function verdictFor(
  outcome: Outcome,
  ctx: { platformName: string; angle: string; goal?: string }
): ExperimentVerdict {
  const signups = num(outcome.signups);
  const revenue = num(outcome.revenue);
  const replies = num(outcome.replies);
  const clicks = num(outcome.clicks);
  const impressions = num(outcome.impressions);
  const goal = ctx.goal || "your conversion goal";

  let call: VerdictCall;
  let reason: string;
  let advice: string;

  if ((signups ?? 0) > 0 || (revenue ?? 0) > 0) {
    call = "supported";
    reason = `It converted: ${signups ?? 0} signup(s)${
      (revenue ?? 0) > 0 ? ` and $${revenue} revenue` : ""
    } — the hypothesis held.`;
    advice = `Keep this angle on ${ctx.platformName}. Post the follow-up variant to an adjacent community while the read is fresh.`;
  } else if ((replies ?? 0) >= 3 || (clicks ?? 0) >= 10) {
    call = "promising";
    reason = `Real engagement (${replies ?? 0} replies, ${clicks ?? 0} clicks) but no ${goal} yet.`;
    advice = `The audience bites on "${clipString(ctx.angle, 80)}" — tighten the call-to-action rather than changing the angle or channel.`;
  } else if ((impressions ?? 0) >= 200) {
    call = "weak";
    reason = `${impressions} impressions but engagement stayed near zero — reach without bite is an angle problem.`;
    advice = `Stay on ${ctx.platformName}, swap the angle: lead with a different pain or a concrete number.`;
  } else {
    call = "no-signal";
    reason =
      outcome.checkpoint === "24h"
        ? "Too little data to judge yet — small reach is normal at 24h."
        : "Barely any reach by 72h — this looks like a distribution problem, not a copy problem.";
    advice =
      outcome.checkpoint === "24h"
        ? "Hold — record the 72h check-in before changing anything."
        : `Consider stopping this channel for now and moving the time to your next-ranked channel.`;
  }

  return { call, reason, advice, decidedAt: new Date().toISOString() };
}

/** ≤3 concrete next steps shown right after an outcome is saved. */
export function nextActionsAfter(
  exp: Experiment,
  verdict: ExperimentVerdict,
  strategy: MarketingStrategy | null
): string[] {
  const nextChannel = strategy?.recommendations.find(
    (r) => r.platformId !== exp.platformId && r.priority !== "low"
  );
  switch (verdict.call) {
    case "supported":
      return [
        `Generate the follow-up variant and queue it for an adjacent community`,
        exp.community
          ? `Reply to every comment in ${exp.community} today — converting threads die quietly`
          : `Reply to every comment on the post today`,
        nextChannel
          ? `Start ${nextChannel.platformName} next — it's your top unproven channel`
          : `Note in the review what made this one convert`,
      ];
    case "promising":
      return [
        `Tighten the CTA on the live post (edit or first-reply with a direct link)`,
        `Record the next check-in when it's due — watch clicks → signups`,
        `Generate a variant that keeps the hook but sharpens the ask`,
      ];
    case "weak":
      return [
        `Generate a new-angle variant for ${exp.platformName}`,
        `Skim the qualitative replies for the objection you didn't answer`,
        nextChannel
          ? `If the variant also reads weak, shift to ${nextChannel.platformName}`
          : `If the variant also reads weak, revisit positioning in the full plan`,
      ];
    case "no-signal":
      return exp.outcomes.some((o) => o.checkpoint === "72h")
        ? [
            `Stop this experiment and reallocate the time`,
            nextChannel
              ? `Move to ${nextChannel.platformName} — next-ranked in your plan`
              : `Pick the next channel from the full plan`,
            `Post at the channel's best time window next attempt`,
          ]
        : [
            `Wait for the 72h window before changing anything`,
            `Meanwhile, prep the next planned channel from Today`,
          ];
  }
}

/** Direction handed to the copilot rewrite when generating the follow-up variant. */
export function variantDirection(exp: Experiment, verdict: ExperimentVerdict): string {
  switch (verdict.call) {
    case "supported":
      return `The published version converted (hypothesis: ${exp.hypothesis}). Write a fresh variant of the same angle ("${exp.angle}") suitable for a nearby community — same substance, new opening so it doesn't read as a repost.`;
    case "promising":
      return `The post got engagement but no conversions. Keep the hook and angle ("${exp.angle}"), sharpen the call-to-action so interested readers know the one next step.`;
    default:
      return `The published angle ("${exp.angle}") didn't land (${verdict.reason}). Write a variant leading with a different pain point or a concrete number — change the angle, keep the facts.`;
  }
}

// ---------------------------------------------------------------------------
// Timeline & weekly review

export interface TimelineEvent {
  at: string; // ISO
  icon: string;
  text: string;
}

export function timelineEvents(workspace: WorkspaceState): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const exp of workspace.experiments) {
    events.push({
      at: exp.publishedAt,
      icon: "🚀",
      text: `Published on ${exp.platformName}${exp.community ? ` · ${exp.community}` : ""} — "${clipString(exp.variant, 70)}"`,
    });
    for (const o of exp.outcomes) {
      events.push({
        at: o.recordedAt,
        icon: "📊",
        text: `Recorded ${o.checkpoint} results for ${exp.platformName}${
          exp.verdict ? ` → ${exp.verdict.call}` : ""
        }`,
      });
    }
    if (exp.status === "stopped") {
      events.push({
        at: exp.verdict?.decidedAt ?? exp.publishedAt,
        icon: "⏹",
        text: `Stopped the ${exp.platformName} experiment`,
      });
    }
  }
  for (const t of workspace.taskLog) {
    if (t.status === "skipped") {
      events.push({ at: t.at, icon: "⏭", text: `Skipped: ${clipString(t.title, 70)}` });
    } else if (t.kind === "custom") {
      events.push({ at: t.at, icon: "✅", text: `Done: ${clipString(t.title, 70)}` });
    }
  }
  return events.sort((a, b) => (a.at < b.at ? 1 : -1));
}

export interface WeeklyReview {
  loopsThisWeek: number; // ★ the north star: completed learning loops
  loops: { experiment: Experiment; decidedAt: string }[];
  channels: {
    platformId: string;
    platformName: string;
    experiments: number;
    outcomes: number;
    bestCall?: VerdictCall;
  }[];
  bestAngle?: string;
  suggestions: string[]; // ≤3
}

const CALL_RANK: Record<VerdictCall, number> = {
  supported: 3,
  promising: 2,
  weak: 1,
  "no-signal": 0,
};

export function weeklyReview(
  plan: Pick<PlanSlice, "strategy" | "workspace">,
  now: Date
): WeeklyReview {
  const { workspace, strategy } = plan;
  const weekAgo = now.getTime() - 7 * 24 * HOUR;

  // A learning loop is COMPLETE when an outcome produced a verdict.
  const loops = workspace.experiments
    .filter((e) => e.verdict)
    .map((e) => ({ experiment: e, decidedAt: e.verdict!.decidedAt }));
  const loopsThisWeek = loops.filter(
    (l) => new Date(l.decidedAt).getTime() >= weekAgo
  ).length;

  const byChannel = new Map<string, WeeklyReview["channels"][number]>();
  for (const e of workspace.experiments) {
    const row = byChannel.get(e.platformId) ?? {
      platformId: e.platformId,
      platformName: e.platformName,
      experiments: 0,
      outcomes: 0,
      bestCall: undefined,
    };
    row.experiments++;
    row.outcomes += e.outcomes.length;
    if (
      e.verdict &&
      (!row.bestCall || CALL_RANK[e.verdict.call] > CALL_RANK[row.bestCall])
    ) {
      row.bestCall = e.verdict.call;
    }
    byChannel.set(e.platformId, row);
  }

  const best = [...workspace.experiments]
    .filter((e) => e.verdict)
    .sort((a, b) => CALL_RANK[b.verdict!.call] - CALL_RANK[a.verdict!.call])[0];

  const suggestions: string[] = [];
  if (best && best.verdict!.call !== "no-signal") {
    suggestions.push(
      `Double down on what worked: "${clipString(best.angle, 70)}" (${best.platformName}, ${best.verdict!.call}).`
    );
  }
  const unproven = strategy?.recommendations.find(
    (r) => !byChannel.has(r.platformId) && r.priority === "high"
  );
  if (unproven) {
    suggestions.push(
      `${unproven.platformName} is your highest-ranked channel with no experiment yet — schedule it.`
    );
  }
  const openCheckins = workspace.experiments.filter(
    (e) => dueCheckpoints(e, now).length > 0
  ).length;
  if (openCheckins) {
    suggestions.push(
      `${openCheckins} check-in${openCheckins > 1 ? "s" : ""} waiting — loops only count once results are recorded.`
    );
  }
  if (suggestions.length === 0 && loops.length === 0) {
    suggestions.push("Publish your first planned post — the loop starts on Today.");
  }

  return {
    loopsThisWeek,
    loops,
    channels: [...byChannel.values()],
    bestAngle: best ? best.angle : undefined,
    suggestions: suggestions.slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Proactive briefing (M16) — deterministic, zero model calls, can't hallucinate.

export interface Briefing {
  lines: string[];
  chips: { label: string; prompt: string }[]; // hand a specific ask to the model
}

/** What the copilot opens with: today, overdue check-ins, weekly state, and
 *  the next experiment worth designing — all computed from the plan. */
export function buildBriefing(plan: PlanSlice, now: Date): Briefing {
  const lines: string[] = [];
  const chips: Briefing["chips"] = [];

  const today = deriveToday(plan, now);
  const due = today.actions.filter((a) => a.due);
  if (due.length) {
    lines.push(
      `Today: ${due.length} action${due.length > 1 ? "s" : ""} (~${today.plannedMinutes} min${
        today.weeklyMinutes ? ` of your ${today.weeklyMinutes} min/week` : ""
      }): ${due.map((a) => a.title).join(" · ")}`
    );
  } else {
    lines.push("Today: all caught up — nothing due.");
  }

  if (today.dueRecordCount > 0) {
    lines.push(
      `${today.dueRecordCount} check-in${today.dueRecordCount > 1 ? "s" : ""} waiting — loops only count once results are recorded.`
    );
    chips.push({
      label: "What should I watch for in the results?",
      prompt: "What should I watch for when I record the due check-in results?",
    });
  }

  const review = weeklyReview(plan, now);
  if (plan.workspace.experiments.length) {
    lines.push(
      `Loops closed this week: ${review.loopsThisWeek}${
        review.bestAngle
          ? ` · best angle so far: “${clipString(review.bestAngle, 60)}”`
          : ""
      }`
    );
    chips.push({
      label: "Run my weekly review",
      prompt:
        "Walk me through my weekly review: what did the loops teach, which channel/angle deserves next week, what should I stop?",
    });
  }

  const unproven = review.suggestions.find((s) => s.includes("no experiment yet"));
  if (unproven) {
    lines.push(unproven);
    chips.push({
      label: "Design the next experiment",
      prompt:
        "Design my next experiment (use create_experiment): pick the channel and angle from the plan, justify with evidence, and write the hypothesis.",
    });
  }

  return { lines, chips };
}
