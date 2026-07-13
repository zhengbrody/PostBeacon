import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DELETE_USER_DATA_RPC,
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

function deleteClient(
  opts: { rpcErrorCode?: string; failTable?: string; failAuth?: boolean } = {}
) {
  const calls: { table: string; column: string; value: string }[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  let authDeleted: string | null = null;
  return {
    calls,
    rpcCalls,
    authDeleted: () => authDeleted,
    client: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return opts.rpcErrorCode ? { error: { code: opts.rpcErrorCode } } : { error: null };
      },
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

  it("every user table enables RLS and declares an owner-scoped policy", () => {
    const schema = readFileSync(join(__dirname, "../supabase/schema.sql"), "utf-8");
    for (const table of USER_TABLES_DELETE_ORDER) {
      expect(schema).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`, "i")
      );
      expect(schema).toMatch(
        new RegExp(
          `create policy [\\s\\S]{0,80} on public\\.${table}[\\s\\S]{0,160}auth\\.uid\\(\\) = user_id`,
          "i"
        )
      );
    }
  });

  it("every user table cascades from auth.users and workspace parents cascade", () => {
    const schema = readFileSync(join(__dirname, "../supabase/schema.sql"), "utf-8");
    for (const table of USER_TABLES_DELETE_ORDER) {
      const block = schema
        .split(`create table if not exists public.${table}`)[1]
        ?.split(";")[0];
      expect(block, `${table} table definition missing`).toBeTruthy();
      expect(block, `${table} must cascade when its auth user is removed`).toMatch(
        /user_id uuid[^,]*references auth\.users \(id\) on delete cascade/i
      );
    }
    expect(schema).toMatch(
      /project_id uuid[^,]*references public\.projects \(id\) on delete cascade/i
    );
    expect(
      schema.match(
        /campaign_id uuid[^,]*references public\.campaigns \(id\) on delete cascade/gi
      )
    ).toHaveLength(2);
    expect(schema).toMatch(
      /experiment_id uuid[^,]*references public\.experiments \(id\) on delete cascade/i
    );
  });

  it("the production repair migration installs the workspace boundary and locked RPC", () => {
    const migration = readFileSync(
      join(__dirname, "../supabase/migrations/20260713_workspace_and_delete_rpc.sql"),
      "utf-8"
    );
    expect(migration).toMatch(/^--[\s\S]*\nbegin;/i);
    expect(migration.trimEnd()).toMatch(/commit;$/i);
    for (const table of ["campaigns", "experiments", "outcomes", "tasks"]) {
      expect(migration).toMatch(
        new RegExp(`create table if not exists public\\.${table}`, "i")
      );
      expect(migration).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`, "i")
      );
    }
    expect(migration).toContain(`function public.${DELETE_USER_DATA_RPC}`);
    expect(migration).toMatch(
      /revoke all on function[\s\S]*from public, anon, authenticated/i
    );
    expect(migration).toMatch(/grant execute on function[\s\S]*to service_role/i);
  });

  it("the production audit reports explicit PASS/FAIL rows for missing objects", () => {
    const audit = readFileSync(join(__dirname, "../supabase/audit.sql"), "utf-8");
    expect(audit).toContain("all tables installed");
    expect(audit).toContain("workspace parent cascades");
    expect(audit).toContain("transactional delete RPC locked");
    expect(audit).toMatch(/case when passed then 'PASS' else 'FAIL' end as status/i);
  });
});

describe("deleteAccountData", () => {
  it("uses the transactional RPC for one user, then removes the auth user", async () => {
    const mock = deleteClient();
    await deleteAccountData(mock.client, "user-1");
    expect(mock.rpcCalls).toEqual([
      { name: DELETE_USER_DATA_RPC, args: { target_user_id: "user-1" } },
    ]);
    expect(mock.calls).toEqual([]);
    expect(mock.authDeleted()).toBe("user-1");
  });

  it("falls back to child→parent deletes when an older install lacks the RPC", async () => {
    const mock = deleteClient({ rpcErrorCode: "PGRST202" });
    await deleteAccountData(mock.client, "user-1");
    expect(mock.calls.map((c) => c.table)).toEqual([...USER_TABLES_DELETE_ORDER]);
    expect(mock.calls.every((c) => c.column === "user_id" && c.value === "user-1")).toBe(
      true
    );
    expect(mock.authDeleted()).toBe("user-1");
  });

  it("tolerates missing tables (42P01 — older installs never wrote them)", async () => {
    const mock = deleteClient({ rpcErrorCode: "42883" }); // "tasks" always 42P01s
    await expect(deleteAccountData(mock.client, "u")).resolves.toBeUndefined();
  });

  it("an RPC failure aborts before fallback deletes or auth removal", async () => {
    const mock = deleteClient({ rpcErrorCode: "42501" });
    await expect(deleteAccountData(mock.client, "u")).rejects.toBeInstanceOf(PublicError);
    expect(mock.calls).toEqual([]);
    expect(mock.authDeleted()).toBeNull();
  });

  it("a legacy row-delete failure aborts BEFORE the auth user is removed", async () => {
    const mock = deleteClient({ rpcErrorCode: "PGRST202", failTable: "projects" });
    await expect(deleteAccountData(mock.client, "u")).rejects.toBeInstanceOf(PublicError);
    expect(mock.authDeleted()).toBeNull();
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
