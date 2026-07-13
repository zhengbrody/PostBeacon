import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteAccountData,
  exportAccountData,
  EXPORT_TABLES,
  USER_TABLES_DELETE_ORDER,
} from "@/lib/account";
import { PublicError } from "@/lib/errors";

/** Minimal thenable-style mock matching the supabase-js call shapes we use. */
function exportClient(rows: Record<string, unknown[]>, failTable?: string) {
  const queried: string[] = [];
  return {
    queried,
    client: {
      from: (table: string) => ({
        select: async () => {
          queried.push(table);
          if (table === failTable) return { data: null, error: { code: "XX000" } };
          if (!(table in rows)) return { data: null, error: { code: "42P01" } };
          return { data: rows[table], error: null };
        },
      }),
    } as unknown as SupabaseClient,
  };
}

function deleteClient(opts: { failTable?: string; failAuth?: boolean } = {}) {
  const calls: { table: string; column: string; value: string }[] = [];
  let authDeleted: string | null = null;
  return {
    calls,
    authDeleted: () => authDeleted,
    client: {
      from: (table: string) => ({
        delete: () => ({
          eq: async (column: string, value: string) => {
            calls.push({ table, column, value });
            if (table === opts.failTable) return { error: { code: "XX000" } };
            if (table === "tasks") return { error: { code: "42P01" } }; // not installed
            return { error: null };
          },
        }),
      }),
      auth: {
        admin: {
          deleteUser: async (id: string) => {
            if (opts.failAuth) return { error: { message: "nope" } };
            authDeleted = id;
            return { error: null };
          },
        },
      },
    } as unknown as SupabaseClient,
  };
}

describe("deletion cleanup coverage (the 'nothing survives' proof)", () => {
  it("every user table in schema.sql is either wiped on account deletion or explicitly non-personal", () => {
    const schema = readFileSync(join(__dirname, "../supabase/schema.sql"), "utf-8");
    const tables = [...schema.matchAll(/create table if not exists public\.(\w+)/g)].map(
      (m) => m[1]
    );
    expect(tables.length).toBeGreaterThanOrEqual(7);
    // webhook_events stores Polar event ids only (no user linkage, no personal
    // data) — it is swept by the retention task instead (tests/retention.test.ts).
    const nonPersonal = ["webhook_events"];
    for (const table of tables) {
      const covered =
        (USER_TABLES_DELETE_ORDER as readonly string[]).includes(table) ||
        nonPersonal.includes(table);
      expect(covered, `table "${table}" has no deletion path`).toBe(true);
    }
  });

  it("schema user tables all carry a user_id for the explicit wipe to key on", () => {
    const schema = readFileSync(join(__dirname, "../supabase/schema.sql"), "utf-8");
    for (const table of USER_TABLES_DELETE_ORDER) {
      const block = schema.split(`public.${table}`)[1]?.slice(0, 600) ?? "";
      expect(block.includes("user_id"), `${table} lacks user_id`).toBe(true);
    }
  });
});

describe("deleteAccountData", () => {
  it("wipes every table child→parent, keyed on the user, then removes the auth user", async () => {
    const mock = deleteClient();
    await deleteAccountData(mock.client, "user-1");
    expect(mock.calls.map((c) => c.table)).toEqual([...USER_TABLES_DELETE_ORDER]);
    expect(mock.calls.every((c) => c.column === "user_id" && c.value === "user-1")).toBe(
      true
    );
    expect(mock.authDeleted()).toBe("user-1");
  });

  it("tolerates missing tables (42P01 — older installs never wrote them)", async () => {
    const mock = deleteClient(); // its "tasks" table always 42P01s
    await expect(deleteAccountData(mock.client, "u")).resolves.toBeUndefined();
  });

  it("a real row-delete failure aborts BEFORE the auth user is removed", async () => {
    const mock = deleteClient({ failTable: "projects" });
    await expect(deleteAccountData(mock.client, "u")).rejects.toBeInstanceOf(PublicError);
    expect(mock.authDeleted()).toBeNull(); // account still exists → user can retry
  });

  it("auth-user removal failure surfaces as a PublicError telling the user to contact us", async () => {
    const mock = deleteClient({ failAuth: true });
    await expect(deleteAccountData(mock.client, "u")).rejects.toThrow(/contact us/i);
  });
});

describe("exportAccountData", () => {
  const rows = {
    projects: [{ id: "p1", meta: { memory: { tone: "dry" } } }],
    campaigns: [{ id: "c1" }],
    experiments: [{ id: "e1" }],
    outcomes: [{ id: "o1" }],
    tasks: [],
    entitlements: [{ plan: "free" }],
  };

  it("reads every user table and returns the full labeled bundle", async () => {
    const mock = exportClient(rows);
    const out = await exportAccountData(mock.client, { id: "u", email: "e@x.io" });
    expect([...mock.queried].sort()).toEqual([...EXPORT_TABLES].sort());
    expect(out.format).toBe("postbeacon-account-export");
    expect(out.user).toEqual({ id: "u", email: "e@x.io" });
    expect(out.projects).toHaveLength(1);
    expect(out.entitlement).toEqual({ plan: "free" });
    // projects.meta rides along — memory/workspace live there, so the export
    // is complete without extra table reads.
    expect(JSON.stringify(out.projects)).toContain('"tone":"dry"');
  });

  it("missing workspace tables export as empty instead of failing the request", async () => {
    const mock = exportClient({ projects: rows.projects, entitlements: [] });
    const out = await exportAccountData(mock.client, { id: "u", email: null });
    expect(out.experiments).toEqual([]);
    expect(out.entitlement).toBeNull();
  });

  it("a real read failure throws a PublicError with no table internals leaked", async () => {
    const mock = exportClient(rows, "projects");
    await expect(exportAccountData(mock.client, { id: "u", email: null })).rejects.toThrow(
      "Export failed. Try again."
    );
  });
});
