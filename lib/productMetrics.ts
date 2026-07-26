import type { SupabaseClient } from "@supabase/supabase-js";

const DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1_000;
const MAX_PAGES = 100;

export interface ProjectMetricRow {
  id: string;
  user_id: string;
  updated_at: string;
}

export interface CampaignMetricRow {
  id: string;
  user_id: string;
  updated_at: string;
}

export interface ExperimentMetricRow {
  id: string;
  user_id: string;
  status: string;
  published_at: string;
}

export interface OutcomeMetricRow {
  id: string;
  experiment_id: string;
  user_id: string;
  checkpoint: string;
  recorded_at: string;
}

export interface TaskMetricRow {
  id: string;
  campaign_id: string;
  user_id: string;
  acted_at: string;
}

export interface ProductMetricRows {
  projects: ProjectMetricRow[];
  generatedPlans: { id: string; user_id: string }[];
  campaigns: CampaignMetricRow[];
  experiments: ExperimentMetricRow[];
  outcomes: OutcomeMetricRow[];
  tasks: TaskMetricRow[];
}

export interface ProductMetrics {
  generatedAt: string;
  windowDays: 7;
  funnel: {
    savedProjectUsers: number;
    generatedPlanUsers: number;
    publishedUsers: number;
    measuredUsers: number;
    completedLoopUsers: number;
    savedProjects: number;
    generatedPlans: number;
    experimentsPublished: number;
    outcomesRecorded: number;
    learningLoopsCompleted: number;
    conversion: {
      savedToPlan: number | null;
      planToPublish: number | null;
      publishToMeasure: number | null;
      measureToLoop: number | null;
    };
  };
  retention: {
    currentWindow: { from: string; to: string; activeUsers: number };
    previousWindow: { from: string; to: string; activeUsers: number };
    retainedUsers: number;
    weeklyRetentionRate: number | null;
    currentCompletedLoops: number;
    previousCompletedLoops: number;
    evidence: "no-baseline" | "directional" | "usable";
  };
  privacy: {
    aggregateOnly: true;
    containsUserIds: false;
    containsSubmittedContent: false;
    containsOutcomeValues: false;
  };
}

interface PageResult<T> {
  data: T[] | null;
  error: { code?: string; message?: string } | null;
}

async function allRows<T>(
  load: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const result = await load(from, from + PAGE_SIZE - 1);
    if (result.error) throw new Error("Product metrics query failed.");
    const next = result.data ?? [];
    rows.push(...next);
    if (next.length < PAGE_SIZE) return rows;
  }
  // Failing is safer than publishing a silently truncated operator metric.
  throw new Error("Product metrics query exceeded its safe row limit.");
}

/** Load only identity keys and lifecycle timestamps; never plan/draft/outcome content. */
export async function loadProductMetricRows(
  sb: SupabaseClient
): Promise<ProductMetricRows> {
  const [projects, generatedPlans, campaigns, experiments, outcomes, tasks] =
    await Promise.all([
      allRows<ProjectMetricRow>(
        (from, to) =>
          sb
            .from("projects")
            .select("id,user_id,updated_at")
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<PageResult<ProjectMetricRow>>
      ),
      allRows<{ id: string; user_id: string }>(
        (from, to) =>
          sb
            .from("projects")
            .select("id,user_id")
            .not("result", "is", null)
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<
            PageResult<{ id: string; user_id: string }>
          >
      ),
      allRows<CampaignMetricRow>(
        (from, to) =>
          sb
            .from("campaigns")
            .select("id,user_id,updated_at")
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<PageResult<CampaignMetricRow>>
      ),
      allRows<ExperimentMetricRow>(
        (from, to) =>
          sb
            .from("experiments")
            .select("id,user_id,status,published_at")
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<PageResult<ExperimentMetricRow>>
      ),
      allRows<OutcomeMetricRow>(
        (from, to) =>
          sb
            .from("outcomes")
            .select("id,experiment_id,user_id,checkpoint,recorded_at")
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<PageResult<OutcomeMetricRow>>
      ),
      allRows<TaskMetricRow>(
        (from, to) =>
          sb
            .from("tasks")
            .select("id,campaign_id,user_id,acted_at")
            .order("campaign_id", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<PageResult<TaskMetricRow>>
      ),
    ]);
  return { projects, generatedPlans, campaigns, experiments, outcomes, tasks };
}

function ids(rows: { user_id: string }[]): Set<string> {
  return new Set(rows.map((row) => row.user_id).filter(Boolean));
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function within(value: string, from: number, to: number): boolean {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= from && time < to;
}

function activeUsers(rows: ProductMetricRows, from: number, to: number): Set<string> {
  const active = new Set<string>();
  const add = (userId: string, at: string) => {
    if (userId && within(at, from, to)) active.add(userId);
  };
  rows.projects.forEach((row) => add(row.user_id, row.updated_at));
  rows.campaigns.forEach((row) => add(row.user_id, row.updated_at));
  rows.experiments.forEach((row) => add(row.user_id, row.published_at));
  rows.outcomes.forEach((row) => add(row.user_id, row.recorded_at));
  rows.tasks.forEach((row) => add(row.user_id, row.acted_at));
  return active;
}

function completedLoopIds(
  rows: ProductMetricRows,
  from?: number,
  to?: number
): Set<string> {
  const analyzed = new Set(
    rows.experiments
      .filter((experiment) => experiment.status === "analyzed")
      .map((experiment) => experiment.id)
  );
  return new Set(
    rows.outcomes
      .filter(
        (outcome) =>
          analyzed.has(outcome.experiment_id) &&
          outcome.checkpoint !== "manual" &&
          (from === undefined || to === undefined || within(outcome.recorded_at, from, to))
      )
      .map((outcome) => outcome.experiment_id)
  );
}

/**
 * The retention north star is a completed learning loop, while weekly active
 * means a saved-project edit, campaign update, publish, outcome, or task action.
 * Returned output contains counts only; raw ids are discarded here.
 */
export function buildProductMetrics(
  rows: ProductMetricRows,
  now: Date = new Date()
): ProductMetrics {
  const to = now.getTime();
  const currentFrom = to - 7 * DAY;
  const previousFrom = to - 14 * DAY;
  const projectUsers = ids(rows.projects);
  const planUsers = ids(rows.generatedPlans);
  const publishUsers = ids(rows.experiments);
  const measureUsers = ids(rows.outcomes);
  const allLoopIds = completedLoopIds(rows);
  const loopUsers = ids(
    rows.experiments.filter((experiment) => allLoopIds.has(experiment.id))
  );
  const currentActive = activeUsers(rows, currentFrom, to);
  const previousActive = activeUsers(rows, previousFrom, currentFrom);
  const retainedUsers = intersectionSize(previousActive, currentActive);
  const currentLoops = completedLoopIds(rows, currentFrom, to).size;
  const previousLoops = completedLoopIds(rows, previousFrom, currentFrom).size;

  return {
    generatedAt: now.toISOString(),
    windowDays: 7,
    funnel: {
      savedProjectUsers: projectUsers.size,
      generatedPlanUsers: planUsers.size,
      publishedUsers: publishUsers.size,
      measuredUsers: measureUsers.size,
      completedLoopUsers: loopUsers.size,
      savedProjects: rows.projects.length,
      generatedPlans: rows.generatedPlans.length,
      experimentsPublished: rows.experiments.length,
      outcomesRecorded: rows.outcomes.length,
      learningLoopsCompleted: allLoopIds.size,
      conversion: {
        savedToPlan: rate(intersectionSize(projectUsers, planUsers), projectUsers.size),
        planToPublish: rate(intersectionSize(planUsers, publishUsers), planUsers.size),
        publishToMeasure: rate(
          intersectionSize(publishUsers, measureUsers),
          publishUsers.size
        ),
        measureToLoop: rate(intersectionSize(measureUsers, loopUsers), measureUsers.size),
      },
    },
    retention: {
      currentWindow: {
        from: new Date(currentFrom).toISOString(),
        to: now.toISOString(),
        activeUsers: currentActive.size,
      },
      previousWindow: {
        from: new Date(previousFrom).toISOString(),
        to: new Date(currentFrom).toISOString(),
        activeUsers: previousActive.size,
      },
      retainedUsers,
      weeklyRetentionRate: rate(retainedUsers, previousActive.size),
      currentCompletedLoops: currentLoops,
      previousCompletedLoops: previousLoops,
      evidence:
        previousActive.size === 0
          ? "no-baseline"
          : previousActive.size < 10
            ? "directional"
            : "usable",
    },
    privacy: {
      aggregateOnly: true,
      containsUserIds: false,
      containsSubmittedContent: false,
      containsOutcomeValues: false,
    },
  };
}
