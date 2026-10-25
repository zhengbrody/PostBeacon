import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicError } from "./errors";
import { asRecord } from "./coerce";

/**
 * Account data rights (M17): export everything, delete everything.
 * Both take the Supabase client as a seam so tests can assert the complete
 * boundary. Deletion prefers one transactional database RPC; the explicit
 * child → parent path remains only as a compatibility fallback for older
 * installs until their migration is applied.
 */

/** Every user-owned table, child-before-parent so explicit deletes never hit FK errors. */
export const USER_TABLES_DELETE_ORDER = [
  "agent_runs",
  "agent_daily_usage",
  "outcomes",
  "tasks",
  "experiments",
  "campaigns",
  "projects",
  "entitlements",
] as const;

export const DELETE_USER_DATA_RPC = "delete_postbeacon_user_data";

export interface AccountExport {
  exportedAt: string;
  format: "postbeacon-account-export";
  version: 1;
  user: { id: string; email: string | null };
  /** Full rows, including projects.meta (workspace, memory, facts, selection). */
  projects: unknown[];
  campaigns: unknown[];
  experiments: unknown[];
  outcomes: unknown[];
  tasks: unknown[];
  entitlement: unknown | null;
  agentRuns: unknown[];
  agentUsage: unknown[];
}

/** Tables the export reads (superset check lives in tests against schema.sql). */
export const EXPORT_TABLES = [
  "projects",
  "campaigns",
  "experiments",
  "outcomes",
  "tasks",
  "entitlements",
  "agent_runs",
  "agent_daily_usage",
] as const;

/**
 * Read every row the user owns. Works with a USER-SCOPED client (anon key +
 * the caller's bearer token): RLS guarantees each query only returns their
 * rows, so no service role is needed to exercise this right. Workspace tables
 * may not exist on older installs (42P01) — exported as empty rather than
 * failing the whole export.
 */
export async function exportAccountData(
  sb: SupabaseClient,
  user: { id: string; email: string | null }
): Promise<AccountExport> {
  const missingAgentTables = new Set<string>();
  async function rows(table: (typeof EXPORT_TABLES)[number]): Promise<unknown[]> {
    const result: unknown[] = [];
    let expected: number | undefined;
    for (let page = 0; page < 200; page += 1) {
      let query = sb.from(table).select("*", { count: "exact" }).eq("user_id", user.id);
      query =
        table === "tasks"
          ? query.order("campaign_id", { ascending: true }).order("id", { ascending: true })
          : query.order(
              table === "agent_daily_usage"
                ? "day"
                : table === "entitlements"
                  ? "user_id"
                  : "id",
              { ascending: true }
            );
      const { data, error, count } = await query.range(result.length, result.length + 499);
      if (error) {
        if (
          ["agent_runs", "agent_daily_usage"].includes(table) &&
          ["42P01", "PGRST205"].includes(error.code) &&
          result.length === 0
        ) {
          missingAgentTables.add(table);
          return [];
        }
        if (error.code === "42P01" && result.length === 0) return [];
        throw new PublicError("Export failed. Try again.", 500);
      }
      if (
        typeof count !== "number" ||
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > 100_000
      )
        throw new PublicError(
          "Export could not verify its complete row count. Contact us if retrying fails.",
          500
        );
      if (expected !== undefined && expected !== count)
        throw new PublicError(
          "Your data changed during export. Wait for saving to finish and retry.",
          409
        );
      expected = count;
      const batch = data ?? [];
      if (
        result.length + batch.length > expected ||
        (!batch.length && result.length < expected)
      )
        throw new PublicError(
          "Export stopped because some rows could not be read. Try again.",
          500
        );
      result.push(...batch);
      if (result.length === expected) return result;
    }
    throw new PublicError(
      "Export exceeded its safe page limit. Contact us for a complete export.",
      500
    );
  }

  const [
    projects,
    campaigns,
    experiments,
    outcomes,
    tasks,
    entitlements,
    agentRuns,
    agentUsage,
  ] = await Promise.all(EXPORT_TABLES.map(rows));

  if (missingAgentTables.size && asRecord(entitlements[0]).agent_data_initialized === true)
    throw new PublicError(
      "Your Agent history could not be read completely. Retry after the database schema is available; no partial export was returned.",
      503
    );

  return {
    exportedAt: new Date().toISOString(),
    format: "postbeacon-account-export",
    version: 1,
    user,
    projects,
    campaigns,
    experiments,
    outcomes,
    tasks,
    entitlement: entitlements[0] ?? null,
    agentRuns,
    agentUsage,
  };
}

/**
 * Erase the account: the database RPC deletes every owned row in one
 * transaction, then the auth user is removed (email/OAuth identity and display
 * name). Older installs without the RPC retain the explicit child→parent
 * fallback until their migration is applied. Requires the SERVICE-ROLE client.
 */
export async function deleteAccountData(sb: SupabaseClient, userId: string): Promise<void> {
  const { error: rpcError } = await sb.rpc(DELETE_USER_DATA_RPC, {
    target_user_id: userId,
  });

  // PGRST202/42883 = migration not installed or PostgREST schema cache has not
  // seen it yet. Keep old deployments functional, but prefer the atomic RPC.
  if (rpcError && !["PGRST202", "42883"].includes(rpcError.code)) {
    throw new PublicError(
      "Account deletion stopped before database changes were committed. Retry or contact us.",
      500
    );
  }
  if (rpcError) {
    for (const table of USER_TABLES_DELETE_ORDER) {
      const { error } = await sb.from(table).delete().eq("user_id", userId);
      // Missing table (42P01) is fine — older installs never wrote it.
      if (
        error &&
        error.code !== "42P01" &&
        !(["agent_runs", "agent_daily_usage"].includes(table) && error.code === "PGRST205")
      ) {
        throw new PublicError(
          "Account deletion stopped before the account record was removed. Some data may already be deleted; retry or contact us.",
          500
        );
      }
    }
  }

  const { error } = await sb.auth.admin.deleteUser(userId);
  if (error) {
    throw new PublicError(
      "Account deletion is not complete because the account record could not be removed. Contact us to finish.",
      500
    );
  }
}
