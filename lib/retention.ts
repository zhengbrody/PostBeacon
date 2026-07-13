import type { SupabaseClient } from "@supabase/supabase-js";

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
  const events = await sb
    .from("webhook_events")
    .delete({ count: "exact" })
    .lt("received_at", cutoff);

  return {
    enabled: true,
    cutoff,
    projectsDeleted: projects.count ?? 0,
    webhookEventsDeleted: events.count ?? 0,
  };
}
