import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { retentionCutoff, runRetention } from "@/lib/retention";
import { retentionDays } from "@/lib/privacy";
import { GET as retentionRoute } from "@/app/api/retention/route";
import type { NextRequest } from "next/server";

function sweepClient(failTable?: string, code = "XX000") {
  const calls: { table: string; column: string; cutoff: string }[] = [];
  return {
    calls,
    client: {
      from: (table: string) => ({
        delete: () => ({
          lt: async (column: string, cutoff: string) => {
            calls.push({ table, column, cutoff });
            return {
              count: table === "projects" ? 2 : 5,
              error: table === failTable ? { code } : null,
            };
          },
        }),
      }),
    } as unknown as SupabaseClient,
  };
}

function req(auth?: string): NextRequest {
  return new Request("http://localhost/api/retention", {
    headers: auth ? { authorization: auth } : {},
  }) as unknown as NextRequest;
}

const ENV_KEYS = ["CRON_SECRET", "RETENTION_DAYS", "BUFFER_PUBLISHING_ENABLED"] as const;
const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);
afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("retention configuration", () => {
  it("retentionDays: absent, zero, junk ⇒ null (retention OFF — the privacy page renders 'kept until you delete')", () => {
    delete process.env.RETENTION_DAYS;
    expect(retentionDays()).toBeNull();
    process.env.RETENTION_DAYS = "0";
    expect(retentionDays()).toBeNull();
    process.env.RETENTION_DAYS = "soon";
    expect(retentionDays()).toBeNull();
    process.env.RETENTION_DAYS = "90.9";
    expect(retentionDays()).toBe(90);
  });

  it("retentionCutoff is exactly N days before now", () => {
    const now = new Date("2026-07-12T00:00:00Z");
    expect(retentionCutoff(30, now)).toBe("2026-06-12T00:00:00.000Z");
  });
});

describe("runRetention sweep", () => {
  it("reports incomplete publishing cleanup and tolerates only pre-install missing tables while off", async () => {
    delete process.env.BUFFER_PUBLISHING_ENABLED;
    await expect(
      runRetention(sweepClient("buffer_oauth_states").client, 30)
    ).rejects.toThrow("publishing cleanup");
    const old = await runRetention(sweepClient("buffer_oauth_states", "42P01").client, 30);
    expect(old.bufferCleanupUnavailable).toBe(true);
    process.env.BUFFER_PUBLISHING_ENABLED = "true";
    await expect(
      runRetention(sweepClient("buffer_oauth_states", "PGRST205").client, 30)
    ).rejects.toThrow("publishing cleanup");
  });
  it("never reports a failed Agent cleanup as successful", async () => {
    await expect(runRetention(sweepClient("agent_daily_usage").client, 30)).rejects.toThrow(
      "could not finish"
    );
    const old = await runRetention(sweepClient("agent_daily_usage", "42P01").client, 30);
    expect(old.enabled).toBe(true); // pre-Agent installs contain no task quota data
    expect(old.agentUsageDeleted).toBe(0);
    expect(old.agentCleanupUnavailable).toBe(true);
    const beforeMigration = await runRetention(
      sweepClient("agent_daily_usage", "PGRST205").client,
      30
    );
    expect(beforeMigration.agentCleanupUnavailable).toBe(true);
  });
  it("stops immediately when project deletion fails", async () => {
    const mock = sweepClient("projects");
    await expect(runRetention(mock.client, 30)).rejects.toThrow("incomplete");
    expect(mock.calls).toHaveLength(1);
  });
  it("deletes stale projects (cascading the workspace) and old webhook ids at the same cutoff", async () => {
    const mock = sweepClient();
    const out = await runRetention(mock.client, 30, new Date("2026-07-12T00:00:00Z"));
    expect(mock.calls).toEqual([
      { table: "projects", column: "updated_at", cutoff: "2026-06-12T00:00:00.000Z" },
      {
        table: "webhook_events",
        column: "received_at",
        cutoff: "2026-06-12T00:00:00.000Z",
      },
      { table: "agent_daily_usage", column: "day", cutoff: "2026-06-12" },
      { table: "agent_daily_totals", column: "day", cutoff: "2026-06-12" },
      { table: "buffer_delivery_daily_usage", column: "day", cutoff: "2026-06-12" },
      { table: "buffer_delivery_daily_totals", column: "day", cutoff: "2026-06-12" },
      { table: "buffer_delivery_account_daily_usage", column: "day", cutoff: "2026-06-12" },
      {
        table: "buffer_oauth_states",
        column: "expires_at",
        cutoff: "2026-07-12T00:00:00.000Z",
      },
    ]);
    expect(out).toEqual({
      enabled: true,
      cutoff: "2026-06-12T00:00:00.000Z",
      projectsDeleted: 2,
      webhookEventsDeleted: 5,
      agentUsageDeleted: 5,
      agentTotalsDeleted: 5,
      bufferUsageDeleted: 5,
      bufferTotalsDeleted: 5,
      bufferAccountUsageDeleted: 5,
      bufferOauthStatesDeleted: 5,
    });
  });
});

describe("/api/retention gate (fails closed)", () => {
  it("503 when no CRON_SECRET is configured — the endpoint can't authenticate anyone", async () => {
    delete process.env.CRON_SECRET;
    const res = await retentionRoute(req("Bearer whatever"));
    expect(res.status).toBe(503);
  });

  it("401 on a wrong or missing bearer", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await retentionRoute(req("Bearer nope"))).status).toBe(401);
    expect((await retentionRoute(req())).status).toBe(401);
  });

  it("authenticated but unconfigured ⇒ {enabled:false}, nothing deleted", async () => {
    process.env.CRON_SECRET = "s3cret";
    delete process.env.RETENTION_DAYS;
    const res = await retentionRoute(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
  });
});
