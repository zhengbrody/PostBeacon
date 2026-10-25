import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicError } from "./errors";

/**
 * Operator-configurable retention sweep (M17). OFF unless RETENTION_DAYS is a
 * positive number (lib/privacy.retentionDays — the /privacy page renders the
 * same value, so the published policy and the job can't disagree). Deletes:
 *   - projects untouched for N days (FKs cascade campaigns → experiments →
 *     outcomes → tasks, and meta carried workspace/memory, so nothing survives)
 *   - webhook_events idempotency ids older than N days (no personal data,
 *     just unbounded growth)
 * Anonymous drafts live in the user's browser and are never touched.
 */

export interface RetentionResult {
  enabled: boolean;
  cutoff?: string;
  projectsDeleted?: number;
  webhookEventsDeleted?: number;
  agentUsageDeleted?: number;
  agentTotalsDeleted?: number;
  agentCleanupUnavailable?: boolean;
}

/** The ISO timestamp N days before `now` — the line everything older dies at. */
export function retentionCutoff(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function runRetention(
  sb: SupabaseClient,
  days: number,
  now: Date = new Date()
): Promise<RetentionResult> {
  const cutoff = retentionCutoff(days, now);

  const projects = await sb
    .from("projects")
    .delete({ count: "exact" })
    .lt("updated_at", cutoff);
  if (projects.error)
    throw new PublicError(
      "Retention could not delete stale projects. The sweep is incomplete.",
      503
    );
  const events = await sb
    .from("webhook_events")
    .delete({ count: "exact" })
    .lt("received_at", cutoff);
  if (events.error)
    throw new PublicError(
      "Retention stopped after the project sweep. Retry to finish the remaining cleanup.",
      503
    );
  // The task content cascades with its project. Independent daily counters have
  // no content and expire at the same operator retention window; never delete today's reservation.
  const usage = await sb
    .from("agent_daily_usage")
    .delete({ count: "exact" })
    .lt("day", cutoff.slice(0, 10));
  const totals = await sb
    .from("agent_daily_totals")
    .delete({ count: "exact" })
    .lt("day", cutoff.slice(0, 10));
  const agentErrors = [usage.error, totals.error].filter(Boolean);
  if (
    agentErrors.some(
      (error) =>
        error &&
        (!["42P01", "PGRST205"].includes(error.code) ||
          process.env.AGENT_RUNS_ENABLED === "true")
    )
  )
    throw new PublicError(
      "Retention could not finish Agent reservation cleanup. Retry the sweep.",
      503
    );

  return {
    enabled: true,
    cutoff,
    projectsDeleted: projects.count ?? 0,
    webhookEventsDeleted: events.count ?? 0,
    agentUsageDeleted: usage.error ? 0 : (usage.count ?? 0),
    agentTotalsDeleted: totals.error ? 0 : (totals.count ?? 0),
    ...(agentErrors.length ? { agentCleanupUnavailable: true } : {}),
  };
}
