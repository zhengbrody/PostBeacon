import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductProfile, WorkspaceState } from "./types";

/**
 * Write-through sync of workspace state into the normalized Supabase tables
 * (campaigns / experiments / outcomes / tasks — see supabase/schema.sql).
 *
 * Persistence tiers (docs/M15-workspace.md §11):
 *   anon                     → localStorage draft (lib/storage.ts, v4)
 *   signed-in, no new tables → projects.meta.workspace jsonb (zero SQL needed)
 *   signed-in, tables exist  → meta.workspace (hydration) + THESE mirrors
 *                              (canonical for queries & future analytics)
 *
 * Availability is feature-detected once per session; every call is
 * best-effort — a failed mirror write never breaks autosave.
 */

let tablesAvailable: boolean | null = null;

async function detectTables(sb: SupabaseClient): Promise<boolean> {
  if (tablesAvailable !== null) return tablesAvailable;
  const { error } = await sb.from("campaigns").select("id").limit(1);
  // 42P01 = relation does not exist → schema.sql hasn't been re-run yet.
  tablesAvailable = !error || error.code !== "42P01";
  return tablesAvailable;
}

/** Test seam: reset the per-session feature-detection cache. */
export function resetWorkspaceTableCache() {
  tablesAvailable = null;
}

export async function syncWorkspaceTables(
  sb: SupabaseClient,
  userId: string,
  projectId: string,
  snap: {
    workspace: WorkspaceState;
    profile: ProductProfile | null;
    launchDate: string;
  }
): Promise<void> {
  try {
    if (!(await detectTables(sb))) return;
    const { workspace, profile, launchDate } = snap;

    const { data: campaign, error: campErr } = await sb
      .from("campaigns")
      .upsert(
        {
          user_id: userId,
          project_id: projectId,
          goal: profile?.conversionGoal ?? null,
          stage: profile?.stage ?? null,
          launch_date: launchDate || null,
          weekly_minutes: workspace.weeklyMinutes ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "project_id" }
      )
      .select("id")
      .single();
    if (campErr || !campaign) return;

    if (workspace.experiments.length) {
      await sb.from("experiments").upsert(
        workspace.experiments.map((e) => ({
          id: e.id,
          campaign_id: campaign.id,
          user_id: userId,
          platform_id: e.platformId,
          community: e.community,
          angle: e.angle,
          variant: e.variant,
          hypothesis: e.hypothesis,
          tracked_url: e.trackedUrl ?? null,
          status: e.status,
          post_idx: e.postIdx,
          published_at: e.publishedAt,
        })),
        { onConflict: "id" }
      );
      const outcomes = workspace.experiments.flatMap((e) =>
        e.outcomes.map((o) => ({
          id: o.id,
          experiment_id: e.id,
          user_id: userId,
          checkpoint: o.checkpoint,
          impressions: o.impressions ?? null,
          replies: o.replies ?? null,
          clicks: o.clicks ?? null,
          signups: o.signups ?? null,
          revenue: o.revenue ?? null,
          qualitative_feedback: o.qualitativeFeedback ?? null,
          recorded_at: o.recordedAt,
        }))
      );
      if (outcomes.length) {
        await sb.from("outcomes").upsert(outcomes, { onConflict: "id" });
      }
    }

    if (workspace.taskLog.length) {
      await sb.from("tasks").upsert(
        workspace.taskLog.map((t) => ({
          id: t.id,
          campaign_id: campaign.id,
          user_id: userId,
          kind: t.kind,
          title: t.title,
          status: t.status,
          est_minutes: t.estMinutes,
          acted_at: t.at,
        })),
        { onConflict: "campaign_id,id" }
      );
    }
  } catch {
    // Mirrors are best-effort; meta.workspace already saved the state.
  }
}
