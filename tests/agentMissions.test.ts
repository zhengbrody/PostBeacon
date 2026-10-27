import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_PROJECT } from "@/lib/demo";
import {
  agentMissionCommandSchema,
  agentMissionSettingsSchema,
  publicAgentMission,
} from "@/lib/agentMissions";
import {
  agentMissionsEnabled,
  pauseAgentMission,
  readAgentMission,
  reserveAgentMissionRun,
  reserveDueAgentMissions,
  saveAgentMission,
} from "@/lib/agentMissionServer";
import { publicAgentRun, agentRunMessage } from "@/lib/agentRuns";
import { exampleOpportunityResearch, researchContextKey } from "@/lib/opportunityResearch";
import type { SuccessContract, TrialResearchInput } from "@/lib/types";

const projectId = "123e4567-e89b-42d3-a456-426614174000";
const missionId = "123e4567-e89b-42d3-a456-426614174001";
const contract: SuccessContract = {
  primaryGoal: "Useful feedback",
  primarySignal: "replies",
  minimumResult: 2,
  evaluationWindow: "72h",
};
const legacy = exampleOpportunityResearch(
  DEMO_PROJECT.profile,
  DEMO_PROJECT.facts,
  contract,
  DEMO_PROJECT.url
);
const brief: TrialResearchInput = { ...legacy.input, mode: "product-led", sources: [] };
const settings = {
  brief,
  searchQueries: ["Developer launch feedback"],
  allowedDomains: ["example.org"],
  enabled: true,
};
const contextKey = researchContextKey(
  DEMO_PROJECT.profile,
  DEMO_PROJECT.facts,
  contract,
  DEMO_PROJECT.url,
  []
);
const now = new Date().toISOString();
const missionRow = {
  id: missionId,
  user_id: "owner",
  project_id: projectId,
  revision: 1,
  enabled: true,
  context_key: contextKey,
  settings,
  created_at: now,
  updated_at: now,
  expires_at: new Date(Date.now() + 86400000).toISOString(),
};
const projectRow = {
  id: projectId,
  url: DEMO_PROJECT.url,
  profile: DEMO_PROJECT.profile,
  updated_at: now,
  meta: {
    facts: DEMO_PROJECT.facts,
    workspace: { successContract: contract },
    memory: { bannedClaims: [] },
  },
};
const runRow = {
  id: "run",
  project_id: projectId,
  provider: "openai",
  payload: { input: brief },
  status: "queued",
  phase: "queued",
  attempts: 0,
  model_attempted: false,
  deadline_at: new Date(Date.now() + 600000).toISOString(),
  created_at: now,
  updated_at: now,
  mission_id: missionId,
  mission_revision: 1,
  search_attempted: false,
};

function db(project: unknown = projectRow, mission: unknown = missionRow) {
  const filters: unknown[][] = [];
  const rpc = vi.fn(async (name: string) => ({
    data: name === "reserve_agent_mission_run" ? runRow : mission,
    error: null,
  }));
  return {
    filters,
    rpc,
    sb: {
      rpc,
      from: vi.fn((table: string) => {
        const q = {
          select: vi.fn(() => q),
          eq: vi.fn((...args: unknown[]) => {
            filters.push([table, ...args]);
            return q;
          }),
          maybeSingle: vi.fn(async () => ({
            data: table === "projects" ? project : mission,
            error: null,
          })),
        };
        return q;
      }),
    } as unknown as SupabaseClient,
  };
}
beforeEach(() => {
  vi.stubEnv("AGENT_RUNS_ENABLED", "true");
  vi.stubEnv("AGENT_MISSIONS_ENABLED", "true");
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("SEARCH_API_KEY", "test-search");
});
afterEach(() => vi.unstubAllEnvs());

describe("daily mission authorization and projections", () => {
  it("requires an explicit product Brief and bounded exact public search permissions", () => {
    expect(agentMissionSettingsSchema.safeParse(settings).success).toBe(true);
    for (const patch of [
      { brief: legacy.input },
      { allowedDomains: ["*.example.org"] },
      { allowedDomains: ["x.com"] },
      { allowedDomains: ["localhost"] },
      { allowedDomains: ["example.org/private"] },
      { searchQueries: ["contact private@example.org"] },
      { searchQueries: ["https://example.org/token"] },
      { searchQueries: ["a".repeat(161)] },
      { allowedDomains: Array(6).fill("example.org") },
      { hiddenProvider: "deepseek" },
    ])
      expect(agentMissionSettingsSchema.safeParse({ ...settings, ...patch }).success).toBe(
        false
      );
  });
  it("requires optimistic revision and explicit consent shape, rejects worker fields", () => {
    const command = {
      action: "save",
      projectId,
      expectedRevision: null,
      contextKey,
      settings,
      consent: { publicSearch: true, openaiProcessing: true },
    };
    expect(agentMissionCommandSchema.safeParse(command).success).toBe(true);
    expect(
      agentMissionCommandSchema.safeParse({ ...command, consent: undefined }).success
    ).toBe(false);
    expect(
      agentMissionCommandSchema.safeParse({ ...command, expectedRevision: undefined })
        .success
    ).toBe(false);
    expect(
      agentMissionCommandSchema.safeParse({ ...command, userId: "other" }).success
    ).toBe(false);
    expect(
      agentMissionCommandSchema.safeParse({ action: "run-now", projectId, contextKey })
        .success
    ).toBe(false);
    expect(
      agentMissionCommandSchema.safeParse({ action: "complete", projectId, output: {} })
        .success
    ).toBe(false);
  });
  it("only projects bounded owner-facing authorization, including expiry", () => {
    const mission = publicAgentMission({
      ...missionRow,
      provider_key: "do-not-expose",
      lease_token: "private-lease",
    });
    expect(mission?.expiresAt).toBe(missionRow.expires_at);
    expect(mission).not.toHaveProperty("user_id");
    expect(JSON.stringify(mission)).not.toContain("private-lease");
    expect(publicAgentMission({ ...missionRow, expires_at: "invalid" })).toBeUndefined();
    expect(publicAgentMission({ ...missionRow, enabled: false })).toBeUndefined();
  });
  it("fails closed without every flag and paid service configuration", () => {
    expect(agentMissionsEnabled()).toBe(true);
    for (const name of [
      "AGENT_RUNS_ENABLED",
      "AGENT_MISSIONS_ENABLED",
      "OPENAI_API_KEY",
      "SEARCH_API_KEY",
    ]) {
      const old = process.env[name];
      vi.stubEnv(name, "");
      expect(agentMissionsEnabled()).toBe(false);
      vi.stubEnv(name, old);
    }
  });
  it("does not offer resume or source-free claims after autonomous search spend", () => {
    const run = publicAgentRun({
      ...runRow,
      status: "running",
      phase: "sources",
      search_attempted: true,
      lease_expires_at: "2020-01-01T00:00:00Z",
    })!;
    expect(run.canResume).toBe(false);
    expect(agentRunMessage(run)).toContain("will not be repeated");
    expect(agentRunMessage({ ...run, interrupted: false })).toContain(
      "approved public queries"
    );
    expect(agentRunMessage({ ...run, status: "ready", interrupted: false })).toContain(
      "No invitation was invented"
    );
    expect(run).not.toHaveProperty("payload");
  });
});

describe("saved context, owner and revocation boundaries", () => {
  it.each([
    ["budget_exhausted", false],
    ["revision_conflict", false],
    ["storage offline", true],
  ])("does not hide dispatcher failure %s as an expected skip", async (message, failed) => {
    const store = db();
    const from = store.sb.from.bind(store.sb);
    store.sb.from = vi.fn((table: string) => {
      if (table !== "agent_missions") return from(table);
      const q = {
        select: () => q,
        eq: () => q,
        gt: () => q,
        or: () => q,
        order: () => q,
        limit: async () => ({ data: [missionRow], error: null }),
        update: () => q,
        then: (resolve: (value: { error: null }) => unknown) =>
          Promise.resolve({ error: null }).then(resolve),
      };
      return q as unknown as ReturnType<SupabaseClient["from"]>;
    });
    store.rpc.mockResolvedValue({ data: null, error: { message } } as never);
    expect(await reserveDueAgentMissions(store.sb)).toEqual(
      failed ? { reserved: [], skipped: 0, failed: 1 } : { reserved: [], skipped: 1 }
    );
  });
  it("reads by project and verified owner rather than browser state", async () => {
    const store = db();
    expect((await readAgentMission(store.sb, "owner", projectId))?.id).toBe(missionId);
    expect(store.filters).toContainEqual(["agent_missions", "user_id", "owner"]);
    expect(store.filters).toContainEqual(["agent_missions", "project_id", projectId]);
  });
  it("saves only after matching the complete saved product context", async () => {
    const store = db();
    const command = agentMissionCommandSchema.parse({
      action: "save",
      projectId,
      expectedRevision: null,
      contextKey,
      settings,
      consent: { publicSearch: true, openaiProcessing: true },
    });
    if (command.action !== "save") throw new Error("fixture");
    await saveAgentMission(store.sb, "owner", command);
    expect(store.rpc).toHaveBeenCalledWith(
      "save_agent_mission",
      expect.objectContaining({
        p_user_id: "owner",
        p_expected_revision: null,
        p_context_key: contextKey,
      })
    );
    const changed = db({
      ...projectRow,
      profile: { ...projectRow.profile, tagline: "Changed product" },
    });
    await expect(saveAgentMission(changed.sb, "owner", command)).rejects.toMatchObject({
      status: 409,
    });
    expect(changed.rpc).not.toHaveBeenCalled();
  });
  it("rejects missing consent, expired missions and revision conflicts before reservation", async () => {
    const store = db();
    const command = agentMissionCommandSchema.parse({
      action: "save",
      projectId,
      expectedRevision: null,
      contextKey,
      settings,
      consent: { publicSearch: false, openaiProcessing: true },
    });
    if (command.action !== "save") throw new Error("fixture");
    await expect(saveAgentMission(store.sb, "owner", command)).rejects.toBeDefined();
    const mission = publicAgentMission(missionRow)!;
    await expect(
      reserveAgentMissionRun(
        store.sb,
        "owner",
        { ...mission, expiresAt: "2020-01-01T00:00:00Z" },
        contextKey
      )
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      reserveAgentMissionRun(store.sb, "owner", mission, contextKey, 2)
    ).rejects.toMatchObject({ status: 409 });
    expect(store.rpc).not.toHaveBeenCalled();
  });
  it("reserves only OpenAI and passes server-rebuilt payload to shared-budget RPC", async () => {
    const store = db();
    await reserveAgentMissionRun(
      store.sb,
      "owner",
      publicAgentMission(missionRow)!,
      contextKey
    );
    expect(store.rpc).toHaveBeenCalledWith(
      "reserve_agent_mission_run",
      expect.objectContaining({
        p_user_id: "owner",
        p_mission_id: missionId,
        p_payload: expect.objectContaining({
          provider: "openai",
          profile: DEMO_PROJECT.profile,
          facts: DEMO_PROJECT.facts,
        }),
      })
    );
  });
  it("permits pausing despite disabled flags and unavailable paid providers", async () => {
    vi.stubEnv("AGENT_MISSIONS_ENABLED", "false");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("SEARCH_API_KEY", "");
    const paused = {
      ...missionRow,
      enabled: false,
      revision: 2,
      settings: { ...settings, enabled: false },
    };
    const store = db(projectRow, paused);
    expect((await pauseAgentMission(store.sb, "owner", projectId))?.enabled).toBe(false);
    expect(store.rpc).toHaveBeenCalledWith("pause_agent_mission", {
      p_user_id: "owner",
      p_project_id: projectId,
    });
  });
  it("fails closed on unreadable installed mission data rather than pretending authorization is absent", async () => {
    const sb = {
      from: vi.fn((table: string) => {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () =>
            table === "agent_missions"
              ? { data: null, error: { code: "PGRST205" } }
              : { data: { mission_data_initialized: true }, error: null },
        };
        return q;
      }),
    } as unknown as SupabaseClient;
    await expect(readAgentMission(sb, "owner", projectId)).rejects.toMatchObject({
      status: 503,
    });
  });
  it("rotates every inspected mission fairly, including stale contexts, without renewing authorization or user activity", async () => {
    const order = vi.fn(),
      updates: Record<string, unknown>[] = [];
    const rows = Array.from({ length: 3 }, (_, i) => ({
      ...missionRow,
      id: `123e4567-e89b-42d3-a456-42661417400${i + 1}`,
      context_key: `stale-context-${i}`,
    }));
    const sb = {
      from: vi.fn((table: string) => {
        let update = false;
        const q = {
          select: () => q,
          eq: () => q,
          gt: () => q,
          or: () => q,
          order: (...args: unknown[]) => {
            order(...args);
            return q;
          },
          limit: async (n: number) => {
            expect(n).toBe(3);
            return { data: rows, error: null };
          },
          update: (value: Record<string, unknown>) => {
            update = true;
            updates.push(value);
            return q;
          },
          maybeSingle: async () => ({
            data: table === "projects" ? projectRow : missionRow,
            error: null,
          }),
          then: (resolve: (value: { error: null }) => unknown) => {
            expect(update).toBe(true);
            return Promise.resolve({ error: null }).then(resolve);
          },
        };
        return q;
      }),
      rpc: vi.fn(),
    } as unknown as SupabaseClient;
    const now = new Date();
    expect(await reserveDueAgentMissions(sb, now)).toEqual({ reserved: [], skipped: 3 });
    expect(order).toHaveBeenCalledWith("last_dispatch_at", {
      ascending: true,
      nullsFirst: true,
    });
    expect(updates).toEqual(Array(3).fill({ last_dispatch_at: now.toISOString() }));
    expect(sb.rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(updates)).not.toMatch(/expires|authorized|context|updated_at/);
  });
});
