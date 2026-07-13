import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicError } from "./errors";

/**
 * Account data rights (M17): export everything, delete everything.
 * Both take the Supabase client as a seam so tests can assert exactly which
 * tables are touched and in what order. Deletion is belt-and-braces: the
 * schema's FKs cascade from auth.users, but we delete each table explicitly
 * (child → parent order) so cleanup doesn't silently depend on cascades
 * existing on older installs — then remove the auth user itself.
 */

/** Every user-owned table, child-before-parent so explicit deletes never hit FK errors. */
export const USER_TABLES_DELETE_ORDER = [
  "outcomes",
  "tasks",
  "experiments",
  "campaigns",
  "projects",
  "entitlements",
] as const;

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
}

/** Tables the export reads (superset check lives in tests against schema.sql). */
export const EXPORT_TABLES = [
  "projects",
  "campaigns",
  "experiments",
  "outcomes",
  "tasks",
  "entitlements",
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
  async function rows(table: string): Promise<unknown[]> {
    const { data, error } = await sb.from(table).select("*");
    if (error) {
      if (error.code === "42P01") return []; // table not installed — nothing to export
      throw new PublicError("Export failed. Try again.", 500);
    }
    return data ?? [];
  }

  const [projects, campaigns, experiments, outcomes, tasks, entitlements] =
    await Promise.all(EXPORT_TABLES.map(rows));

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
  };
}

/**
 * Erase the account: every owned row in child→parent order, then the auth
 * user (which removes email/OAuth identity and display name). Requires the
 * SERVICE-ROLE client — RLS lets users delete most of their rows, but not
 * entitlements (read-only policy) or the auth record, and a partial delete
 * that pretends to be total is worse than refusing. Callers gate on that.
 */
export async function deleteAccountData(sb: SupabaseClient, userId: string): Promise<void> {
  for (const table of USER_TABLES_DELETE_ORDER) {
    const { error } = await sb.from(table).delete().eq("user_id", userId);
    // Missing table (42P01) is fine — older installs never wrote it.
    if (error && error.code !== "42P01") {
      throw new PublicError(
        "Account deletion stopped before the account record was removed. Some data may already be deleted; retry or contact us.",
        500
      );
    }
  }
  const { error } = await sb.auth.admin.deleteUser(userId);
  if (error) {
    throw new PublicError(
      "Your data was deleted but the account record could not be removed. Contact us to finish.",
      500
    );
  }
}
