import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DELETE_USER_DATA_RPC,
  deleteAccountData,
  exportAccountData,
  EXPORT_TABLES,
  PRIVATE_ACCOUNT_TABLES,
  USER_TABLES_DELETE_ORDER,
} from "@/lib/account";
import { PublicError } from "@/lib/errors";

const accountSchema = () =>
  [
    "schema.sql",
    "migrations/20261025_agent_runs.sql",
    "migrations/20261026_agent_missions.sql",
    "migrations/20261026_buffer_connections.sql",
    "migrations/20261026_buffer_deliveries.sql",
  ]
    .map((path) => readFileSync(join(__dirname, "../supabase", path), "utf-8"))
    .join("\n");

/** Minimal thenable-style mock matching the supabase-js call shapes we use. */
function exportClient(
  rows: Record<string, unknown[]>,
  failTable?: string,
  cap = 1000,
  options: {
    count?: (from: number, total: number) => number | null;
    emptyAfterFirst?: boolean;
    failAfterFirst?: string;
    missingAgentCode?: string;
  } = {}
) {
  const queried: string[] = [];
  const filters: { table: string; column: string; value: string }[] = [];
  const ranges: { table: string; from: number; to: number }[] = [];
  return {
    queried,
    filters,
    ranges,
    client: {
      from: (table: string) => ({
        select: () => {
          queried.push(table);
          const page = (from: number, to: number) => {
            if (table === failTable)
              return { data: null, error: { code: "XX000" }, count: null };
            if (!(table in rows))
              return {
                data: null,
                error: {
                  code: table.startsWith("agent_")
                    ? (options.missingAgentCode ?? "42P01")
                    : "42P01",
                },
                count: null,
              };
            if (from > 0 && options.failAfterFirst)
              return { data: null, error: { code: options.failAfterFirst }, count: null };
            return {
              data:
                from > 0 && options.emptyAfterFirst
                  ? []
                  : rows[table].slice(from, Math.min(to + 1, from + cap)),
              error: null,
              count: options.count
                ? options.count(from, rows[table].length)
                : rows[table].length,
            };
          };
          return {
            eq(column: string, value: string) {
              filters.push({ table, column, value });
              return this;
            },
            order() {
              return this;
            },
            async range(from: number, to: number) {
              ranges.push({ table, from, to });
              return page(from, to);
            },
            then(resolve: (value: ReturnType<typeof page>) => unknown) {
              return Promise.resolve(page(0, 999)).then(resolve);
            },
          };
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
    const schema = accountSchema();
    const tables = [...schema.matchAll(/create table if not exists public\.(\w+)/g)].map(
      (m) => m[1]
    );
    expect(tables.length).toBeGreaterThanOrEqual(7);
    // webhook_events stores Polar event ids only (no user linkage, no personal
    // data) — it is swept by the retention task instead (tests/retention.test.ts).
    const nonPersonal = [
      "webhook_events",
      "agent_daily_totals",
      "buffer_delivery_daily_totals",
      "buffer_delivery_account_daily_usage",
    ];
    for (const table of tables) {
      const covered =
        (USER_TABLES_DELETE_ORDER as readonly string[]).includes(table) ||
        nonPersonal.includes(table);
      expect(covered, `table "${table}" has no deletion path`).toBe(true);
    }
  });

  it("schema user tables all carry a user_id for the explicit wipe to key on", () => {
    const schema = accountSchema();
    for (const table of USER_TABLES_DELETE_ORDER) {
      const block =
        schema.split(`create table if not exists public.${table}`)[1]?.split(";")[0] ?? "";
      expect(block.includes("user_id"), `${table} lacks user_id`).toBe(true);
    }
  });

  it("every user table enables RLS and declares an owner-scoped policy", () => {
    const schema = accountSchema();
    for (const table of USER_TABLES_DELETE_ORDER) {
      expect(schema).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`, "i")
      );
      if ((PRIVATE_ACCOUNT_TABLES as readonly string[]).includes(table)) {
        expect(EXPORT_TABLES).not.toContain(table);
        expect(schema).toContain(
          `revoke all on public.${table} from public,anon,authenticated`
        );
        expect(schema).not.toMatch(
          new RegExp(`create policy[^;]*on public\\.${table}\\b`, "i")
        );
        continue;
      }
      expect(schema).toMatch(
        new RegExp(
          `create policy [\\s\\S]{0,80} on public\\.${table}[\\s\\S]{0,160}auth\\.uid\\(\\)\\s*=\\s*user_id`,
          "i"
        )
      );
    }
  });

  it("every user table cascades from auth.users and workspace parents cascade", () => {
    const schema = accountSchema();
    for (const table of USER_TABLES_DELETE_ORDER) {
      const block = schema
        .split(`create table if not exists public.${table}`)[1]
        ?.split(";")[0];
      expect(block, `${table} table definition missing`).toBeTruthy();
      expect(block, `${table} must cascade when its auth user is removed`).toMatch(
        /user_id uuid[^,]*references auth\.users\s*\(id\) on delete cascade/i
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

  it("the production repair includes the server-only webhook ledger", () => {
    const migration = readFileSync(
      join(__dirname, "../supabase/migrations/20260713_webhook_ledger.sql"),
      "utf-8"
    );
    expect(migration).toMatch(/^--[\s\S]*\nbegin;/i);
    expect(migration).toMatch(/create table if not exists public\.webhook_events/i);
    expect(migration).toMatch(
      /alter table public\.webhook_events enable row level security/i
    );
    expect(migration).not.toMatch(/create policy/i);
    expect(migration.trimEnd()).toMatch(/commit;$/i);
  });

  it("the project-save repair installs the complete upsert contract and reloads PostgREST", () => {
    const migration = readFileSync(
      join(__dirname, "../supabase/migrations/20260713_projects_save_contract.sql"),
      "utf-8"
    );
    for (const column of [
      "name",
      "url",
      "profile",
      "strategy",
      "result",
      "posted",
      "meta",
      "created_at",
      "updated_at",
    ]) {
      expect(migration).toMatch(new RegExp(`add column if not exists ${column}\\b`, "i"));
    }
    expect(migration).toMatch(/notify pgrst,\s*'reload schema'/i);
  });

  it("the outcome-verdict migration is transactional and never backfills invented history", () => {
    const migration = readFileSync(
      join(__dirname, "../supabase/migrations/20260802_outcome_verdict.sql"),
      "utf-8"
    );
    expect(migration).toMatch(/^--[\s\S]*\nbegin;/i);
    expect(migration).toMatch(
      /alter table public\.outcomes[\s\S]*add column if not exists verdict jsonb/i
    );
    expect(migration).not.toMatch(/update public\.outcomes/i);
    expect(migration).toMatch(/notify pgrst,\s*'reload schema'/i);
    expect(migration.trimEnd()).toMatch(/commit;$/i);
  });

  it("the production audit reports explicit PASS/FAIL rows for missing objects", () => {
    const audit = readFileSync(join(__dirname, "../supabase/audit.sql"), "utf-8");
    expect(audit).toContain("all tables installed");
    expect(audit).toContain("project save columns installed");
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
  it("exports publishing metadata and full approved text, never grants or server fence keys", async () => {
    const mock = exportClient({
      entitlements: [{ buffer_data_initialized: true }],
      buffer_connections: [
        { id: "conn", account_label: "My X", access_ciphertext: "NEVER_EXPORT" },
      ],
      buffer_deliveries: [
        {
          id: "d",
          snapshot: { body: "Exact approved text", accountQuotaKey: "PRIVATE_HMAC" },
          attempt_token: "PRIVATE_FENCE",
        },
      ],
      buffer_delivery_daily_usage: [{ day: "2026-10-26", reserved_deliveries: 1 }],
    });
    const out = await exportAccountData(mock.client, { id: "u", email: null });
    expect(out.bufferConnections).toEqual([{ id: "conn", account_label: "My X" }]);
    expect(out.bufferDeliveries).toEqual([
      { id: "d", snapshot: { body: "Exact approved text" } },
    ]);
    expect(out.bufferUsage).toHaveLength(1);
    for (const table of [
      ...PRIVATE_ACCOUNT_TABLES,
      "buffer_delivery_daily_totals",
      "buffer_delivery_account_daily_usage",
    ])
      expect(mock.queried).not.toContain(table);
    expect(JSON.stringify(out)).not.toMatch(/NEVER_EXPORT|PRIVATE_HMAC|PRIVATE_FENCE/);
  });
  it("does not hide missing publishing tables after an OAuth round trip has started", async () => {
    const mock = exportClient({ entitlements: [{ buffer_data_initialized: true }] });
    await expect(exportAccountData(mock.client, { id: "u", email: null })).rejects.toThrow(
      "no partial export"
    );
    expect(
      (await exportAccountData(exportClient({}).client, { id: "old", email: null }))
        .bufferConnections
    ).toEqual([]);
  });
  it("keeps pre-mission accounts exportable without hiding later mission history", async () => {
    const old = exportClient(
      {
        entitlements: [{ agent_data_initialized: true }],
        agent_runs: [],
        agent_daily_usage: [],
      },
      undefined,
      1000,
      { missingAgentCode: "PGRST205" }
    );
    expect(
      (await exportAccountData(old.client, { id: "u", email: null })).agentMissions
    ).toEqual([]);
    const initialized = exportClient(
      { entitlements: [{ mission_data_initialized: true }] },
      undefined,
      1000,
      { missingAgentCode: "PGRST205" }
    );
    await expect(
      exportAccountData(initialized.client, { id: "u", email: null })
    ).rejects.toThrow("no partial export");
  });
  it("exports full owned daily authorizations including revision and expiry", async () => {
    const missions = [
      {
        id: "mission-1",
        revision: 2,
        enabled: false,
        expires_at: "2026-11-25T00:00:00Z",
        settings: {
          searchQueries: ["portfolio risk education"],
          allowedDomains: ["example.org"],
        },
      },
    ];
    const mock = exportClient({
      entitlements: [{ mission_data_initialized: true }],
      agent_missions: missions,
    });
    const result = await exportAccountData(mock.client, { id: "u", email: null });
    expect(result.agentMissions).toEqual(missions);
    expect(mock.filters.filter((filter) => filter.table === "agent_missions")).toEqual([
      { table: "agent_missions", column: "user_id", value: "u" },
    ]);
  });
  it("does not silently omit a disappearing mission table halfway through export", async () => {
    const mock = exportClient(
      { agent_missions: [{ id: "a" }, { id: "b" }] },
      undefined,
      1,
      { failAfterFirst: "PGRST205" }
    );
    await expect(exportAccountData(mock.client, { id: "u", email: null })).rejects.toThrow(
      "Export failed"
    );
  });
  it("keeps pre-Agent accounts exportable, but fails closed once task data has existed", async () => {
    const old = exportClient({ projects: [], entitlements: [] }, undefined, 1000, {
      missingAgentCode: "PGRST205",
    });
    expect(
      (await exportAccountData(old.client, { id: "u", email: null })).agentRuns
    ).toEqual([]);
    const used = exportClient(
      { projects: [], entitlements: [{ agent_data_initialized: true }] },
      undefined,
      1000,
      { missingAgentCode: "PGRST205" }
    );
    await expect(exportAccountData(used.client, { id: "u", email: null })).rejects.toThrow(
      "no partial export"
    );
  });
  it("includes full task snapshots and owner counters when installed", async () => {
    const runs = [
      { id: "r", payload: { input: { task: "Try demo" } }, sources: ["receipt"] },
    ];
    const usage = [{ day: "2026-10-24", reserved_runs: 1 }];
    const mock = exportClient({
      projects: [],
      entitlements: [{ agent_data_initialized: true }],
      agent_runs: runs,
      agent_daily_usage: usage,
    });
    const out = await exportAccountData(mock.client, { id: "u", email: null });
    expect(out.agentRuns).toEqual(runs);
    expect(out.agentUsage).toEqual(usage);
    expect(mock.queried).not.toContain("agent_daily_totals");
  });
  it("honors lower server page caps without skipping offsets", async () => {
    const many = Array.from({ length: 751 }, (_, id) => ({ id }));
    const mock = exportClient({ projects: many }, undefined, 100);
    const out = await exportAccountData(mock.client, { id: "u", email: null });
    expect(out.projects).toEqual(many);
    expect(mock.ranges.filter((p) => p.table === "projects").map((p) => p.from)).toEqual([
      0, 100, 200, 300, 400, 500, 600, 700,
    ]);
    expect(
      mock.filters.every((filter) => filter.column === "user_id" && filter.value === "u")
    ).toBe(true);
  });
  it.each([
    "missing-count",
    "changed-count",
    "empty-page",
    "query-failed",
    "table-disappeared",
  ])("fails closed on %s rather than returning a partial account export", async (mode) => {
    const many = Array.from({ length: 1001 }, (_, id) => ({ id }));
    const mock = exportClient({ projects: many }, undefined, 500, {
      count:
        mode === "missing-count"
          ? () => null
          : mode === "changed-count"
            ? (from, total) => total + (from > 0 ? 1 : 0)
            : undefined,
      emptyAfterFirst: mode === "empty-page",
      failAfterFirst:
        mode === "query-failed"
          ? "XX000"
          : mode === "table-disappeared"
            ? "42P01"
            : undefined,
    });
    await expect(
      exportAccountData(mock.client, { id: "u", email: null })
    ).rejects.toBeInstanceOf(PublicError);
  });
  it("fails safely instead of reading forever under extremely low server limits", async () => {
    const many = Array.from({ length: 201 }, (_, id) => ({ id }));
    const mock = exportClient({ projects: many }, undefined, 1);
    await expect(exportAccountData(mock.client, { id: "u", email: null })).rejects.toThrow(
      "safe page limit"
    );
    expect(mock.ranges.filter((p) => p.table === "projects")).toHaveLength(200);
  });
  it("exports beyond the default server page limit without dropping rows", async () => {
    const many = Array.from({ length: 2501 }, (_, i) => ({ id: `project-${i}` }));
    const mock = exportClient({ projects: many, entitlements: [] });
    const out = await exportAccountData(mock.client, { id: "u", email: null });
    expect(out.projects).toHaveLength(many.length);
    expect(out.projects.at(-1)).toEqual(many.at(-1));
  });
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
