import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_PROJECT } from "@/lib/demo";
import { exampleOpportunityResearch } from "@/lib/opportunityResearch";
import { executeAgentRun } from "@/lib/agentRunServer";
import { runAutonomousResearch } from "@/lib/autonomousResearchServer";
import { readAgentMission, savedMissionSnapshot } from "@/lib/agentMissionServer";
import { PublicError } from "@/lib/errors";
const seam = vi.hoisted(() => ({ read: vi.fn(), context: vi.fn() }));
vi.mock("@/lib/autonomousResearchServer", () => ({ runAutonomousResearch: vi.fn() }));
vi.mock("@/lib/agentMissionServer", async (original) => ({
  ...(await original<typeof import("@/lib/agentMissionServer")>()),
  readAgentMission: seam.read,
  savedMissionSnapshot: seam.context,
}));
const contract = {
  primaryGoal: "Feedback",
  primarySignal: "replies" as const,
  minimumResult: 2,
  evaluationWindow: "72h" as const,
};
const old = exampleOpportunityResearch(
  DEMO_PROJECT.profile,
  DEMO_PROJECT.facts,
  contract,
  DEMO_PROJECT.url
);
const input = { ...old.input, mode: "product-led" as const, sources: [] };
const payload = {
  provider: "openai",
  productUrl: DEMO_PROJECT.url,
  profile: DEMO_PROJECT.profile,
  facts: DEMO_PROJECT.facts,
  successContract: contract,
  input,
  bannedClaims: [],
};
const mission = {
  id: "mission",
  projectId: "project",
  revision: 1,
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  contextKey: "context",
  settings: {
    brief: input,
    searchQueries: ["Developer feedback"],
    allowedDomains: ["example.org"],
    enabled: true,
  },
};
const row = {
  id: "run",
  user_id: "owner",
  project_id: "project",
  mission_id: "mission",
  mission_revision: 1,
  lease_token: "private-lease",
  payload,
};
const search = {
  status: "no-results" as const,
  queries: ["Developer feedback"],
  domains: ["example.org"],
  searchedAt: new Date().toISOString(),
  resultCount: 0,
  candidateCount: 0,
};
function db(denied?: string) {
  const calls: { name: string; action: string; data: unknown; projectVersion?: string }[] =
    [];
  return {
    calls,
    sb: {
      rpc: vi.fn(async (name: string, args) => {
        calls.push({
          name,
          action: args.p_action,
          data: args.p_data,
          projectVersion: args.p_project_updated_at,
        });
        return { data: args.p_action === denied ? null : row, error: null };
      }),
    } as unknown as SupabaseClient,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const name of ["AGENT_RUNS_ENABLED", "AGENT_MISSIONS_ENABLED"])
    vi.stubEnv(name, "true");
  vi.stubEnv("OPENAI_API_KEY", "test");
  vi.stubEnv("SEARCH_API_KEY", "test");
  vi.mocked(readAgentMission).mockResolvedValue(
    mission as Awaited<ReturnType<typeof readAgentMission>>
  );
  vi.mocked(savedMissionSnapshot).mockResolvedValue({
    payload: payload as Awaited<ReturnType<typeof savedMissionSnapshot>>["payload"],
    updatedAt: "2026-10-26T00:00:00.000Z",
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("daily worker lease and authorization fencing", () => {
  it("reserves search before work, completes a real no-results receipt without inventing research", async () => {
    const store = db();
    vi.mocked(runAutonomousResearch).mockImplementation(async (args, progress) => {
      expect(args.provider).toBe("openai");
      expect(args).not.toHaveProperty("updatedAt");
      expect(args).not.toHaveProperty("project_updated_at");
      expect(args.search).toEqual({
        queries: mission.settings.searchQueries,
        domains: mission.settings.allowedDomains,
      });
      await progress.beforeSearch();
      expect(store.calls.map((call) => call.action)).toEqual(["claim", "search"]);
      return { search };
    });
    await executeAgentRun(store.sb, "owner", "run");
    expect(store.calls.map((call) => call.action)).toEqual(["claim", "search", "complete"]);
    expect(store.calls.at(-1)?.data).toEqual({ search });
    expect(store.calls.at(-1)?.name).toBe("transition_agent_mission_run");
    expect(
      store.calls
        .filter((call) => call.name === "transition_agent_mission_run")
        .every((call) => call.projectVersion === "2026-10-26T00:00:00.000Z")
    ).toBe(true);
  });
  it("does not issue paid work after a rejected search reservation", async () => {
    const store = db("search");
    let paid = 0;
    vi.mocked(runAutonomousResearch).mockImplementation(async (_args, progress) => {
      await progress.beforeSearch();
      paid++;
      return { search };
    });
    await executeAgentRun(store.sb, "owner", "run");
    expect(paid).toBe(0);
    expect(store.calls.map((call) => call.action)).toEqual(["claim", "search", "fail"]);
  });
  it("rechecks saved facts before search and before the single model reservation", async () => {
    const store = db();
    let paidModels = 0;
    vi.mocked(runAutonomousResearch).mockImplementation(async (_args, progress) => {
      await progress.beforeSearch();
      seam.context.mockRejectedValue(new PublicError("Saved facts changed.", 409));
      await progress.beforeModel();
      paidModels++;
      return { research: old, search };
    });
    await executeAgentRun(store.sb, "owner", "run");
    expect(paidModels).toBe(0);
    expect(store.calls.map((call) => call.action)).toEqual(["claim", "search", "fail"]);
  });
  it("stops a pause/revision race at the model RPC without retry or completion", async () => {
    const store = db("model");
    let paidModels = 0;
    vi.mocked(runAutonomousResearch).mockImplementation(async (_args, progress) => {
      await progress.beforeSearch();
      await progress.sources([]);
      await progress.beforeModel();
      paidModels++;
      return { research: old, search };
    });
    await executeAgentRun(store.sb, "owner", "run");
    expect(paidModels).toBe(0);
    expect(store.calls.map((call) => call.action)).toEqual([
      "claim",
      "search",
      "sources",
      "model",
      "fail",
    ]);
  });
  it("does not start research for an expired or different mission revision", async () => {
    const store = db();
    seam.read.mockResolvedValue({ ...mission, revision: 2 });
    await executeAgentRun(store.sb, "owner", "run");
    expect(runAutonomousResearch).not.toHaveBeenCalled();
    seam.read.mockResolvedValue({ ...mission, expiresAt: "2020-01-01T00:00:00Z" });
    await executeAgentRun(store.sb, "owner", "run");
    expect(runAutonomousResearch).not.toHaveBeenCalled();
  });
  it("carries the exact server-read version to the atomic RPC when autosave changes it before search", async () => {
    let actualVersion = "2026-10-26T00:00:00.000Z",
      paidSearch = 0;
    const actions: string[] = [];
    const sb = {
      rpc: vi.fn(async (name: string, args) => {
        actions.push(args.p_action);
        if (name === "transition_agent_mission_run" && args.p_action === "search") {
          // Another request autosaves after savedMissionSnapshot returns but before
          // the paid checkpoint acquires the project row lock.
          actualVersion = "2026-10-26T00:00:01.000Z";
          expect(args.p_project_updated_at).toBe("2026-10-26T00:00:00.000Z");
          return {
            data: args.p_project_updated_at === actualVersion ? row : null,
            error: null,
          };
        }
        return { data: row, error: null };
      }),
    } as unknown as SupabaseClient;
    vi.mocked(runAutonomousResearch).mockImplementation(async (_args, progress) => {
      await progress.beforeSearch();
      paidSearch++;
      return { search };
    });
    await executeAgentRun(sb, "owner", "run");
    expect(paidSearch).toBe(0);
    expect(actions).toEqual(["claim", "search", "fail"]);
  });
});
