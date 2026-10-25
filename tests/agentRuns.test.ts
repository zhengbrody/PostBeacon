import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicAgentRun, agentRunMessage } from "@/lib/agentRuns";
import { exampleOpportunityResearch } from "@/lib/opportunityResearch";
import { DEMO_PROJECT } from "@/lib/demo";
import { runOpportunityResearch } from "@/lib/opportunityResearchServer";
import { agentCommandSchema, executeAgentRun, reserveAgentRun } from "@/lib/agentRunServer";

vi.mock("@/lib/opportunityResearchServer", () => ({ runOpportunityResearch: vi.fn() }));

const project = {
  ...DEMO_PROJECT,
  workspace: {
    successContract: {
      primaryGoal: "Useful feedback",
      primarySignal: "replies" as const,
      minimumResult: 2,
      evaluationWindow: "72h" as const,
    },
  },
  memory: { bannedClaims: [] as string[] },
};
const research = exampleOpportunityResearch(
  project.profile!,
  project.facts ?? [],
  project.workspace!.successContract!,
  project.url,
  project.memory?.bannedClaims ?? []
);
const payload = {
  provider: "openai",
  productUrl: project.url,
  profile: project.profile,
  facts: project.facts,
  successContract: project.workspace!.successContract,
  input: research.input,
  bannedClaims: project.memory?.bannedClaims ?? [],
};
const row = {
  id: "run-1",
  project_id: "project-1",
  provider: "openai",
  payload,
  status: "running",
  phase: "sources",
  attempts: 1,
  model_attempted: false,
  lease_token: "private-lease",
  lease_expires_at: new Date(Date.now() + 60000).toISOString(),
  deadline_at: new Date(Date.now() + 600000).toISOString(),
  sources: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

afterEach(() => vi.resetAllMocks());

describe("durable Agent receipts", () => {
  it("never exposes lease, raw input snapshot or fabricated progress", () => {
    const run = publicAgentRun(row)!;
    expect(run.phase).toBe("sources");
    expect(run.modelAttempted).toBe(false);
    expect(run.checkedSources).toBe(0);
    expect(JSON.stringify(run)).not.toContain("private-lease");
    expect(run).not.toHaveProperty("payload");
    expect(run).not.toHaveProperty("percentComplete");
  });
  it("allows only bounded pre-model resume after a lease expires", () => {
    const expired = { ...row, lease_expires_at: "2020-01-01T00:00:00Z" };
    expect(publicAgentRun(expired)?.canResume).toBe(true);
    expect(publicAgentRun({ ...expired, model_attempted: true })?.canResume).toBe(false);
    expect(publicAgentRun({ ...expired, attempts: 2 })?.canResume).toBe(false);
    expect(
      publicAgentRun({ ...expired, deadline_at: "2020-01-01T00:00:00Z" })?.canResume
    ).toBe(false);
    expect(
      agentRunMessage(publicAgentRun({ ...expired, model_attempted: true })!)
    ).toContain("unknown");
  });
  it("keeps no-fit and cancellation honest", () => {
    const run = publicAgentRun({
      ...row,
      status: "ready",
      phase: "ready",
      research: { ...research, opportunities: [] },
    })!;
    expect(agentRunMessage(run)).toContain("not evidence");
    expect(agentRunMessage({ ...run, status: "cancelled" })).toContain("may still");
  });
  it("rejects malformed data and forged browser transitions", () => {
    expect(publicAgentRun({ ...row, provider: "claude" })).toBeUndefined();
    expect(publicAgentRun({ ...row, payload: {} })).toBeUndefined();
    expect(
      agentCommandSchema.safeParse({
        action: "complete",
        runId: crypto.randomUUID(),
        research,
      }).success
    ).toBe(false);
    expect(
      agentCommandSchema.safeParse({
        action: "cancel",
        runId: crypto.randomUUID(),
        lease: "stolen",
      }).success
    ).toBe(false);
  });
});

describe("Agent worker spend/cancel boundary", () => {
  function store(rejectAction?: string, claim: unknown = row) {
    const actions: string[] = [];
    return {
      actions,
      sb: {
        rpc: vi.fn(async (_name, args) => {
          actions.push(args.p_action);
          return {
            data:
              args.p_action === "claim"
                ? claim
                : args.p_action === rejectAction
                  ? null
                  : row,
            error: null,
          };
        }),
      } as unknown as SupabaseClient,
    };
  }
  it("does not call research when claim is denied", async () => {
    const db = store(undefined, null);
    await executeAgentRun(db.sb, "owner", "run");
    expect(runOpportunityResearch).not.toHaveBeenCalled();
    expect(db.actions).toEqual(["claim"]);
  });
  it("persists source receipts and model reservation before model work", async () => {
    const db = store();
    vi.mocked(runOpportunityResearch).mockImplementation(async (_payload, progress) => {
      await progress!.sources(research.sources);
      await progress!.beforeModel();
      expect(db.actions).toEqual(["claim", "sources", "model"]);
      return research;
    });
    await executeAgentRun(db.sb, "owner", "run");
    expect(db.actions).toEqual(["claim", "sources", "model", "complete"]);
    expect(runOpportunityResearch).toHaveBeenCalledTimes(1);
  });
  it("stops before the model when cancellation wins the reservation race", async () => {
    const db = store("model");
    let paid = 0;
    vi.mocked(runOpportunityResearch).mockImplementation(async (_payload, progress) => {
      await progress!.sources(research.sources);
      await progress!.beforeModel();
      paid += 1;
      return research;
    });
    await executeAgentRun(db.sb, "owner", "run");
    expect(paid).toBe(0);
    expect(db.actions).toEqual(["claim", "sources", "model", "fail"]);
  });
  it("never retries a failed research call", async () => {
    const db = store();
    vi.mocked(runOpportunityResearch).mockRejectedValue(
      new Error("provider secret detail")
    );
    await executeAgentRun(db.sb, "owner", "run");
    expect(runOpportunityResearch).toHaveBeenCalledTimes(1);
    expect(db.actions).toEqual(["claim", "fail"]);
    expect(db.sb.rpc).toHaveBeenLastCalledWith(
      "transition_agent_run",
      expect.objectContaining({
        p_data: { message: "Research did not complete. No automatic retry." },
      })
    );
  });
  it("rejects unacknowledged DeepSeek before reading a project or reserving spend", async () => {
    const sb = { from: vi.fn(), rpc: vi.fn() };
    await expect(
      reserveAgentRun(sb as unknown as SupabaseClient, "owner", {
        action: "start",
        projectId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        input: research.input,
        contextKey: research.contextKey,
        provider: "deepseek",
        deepseekConsent: false,
      })
    ).rejects.toThrow("acknowledge");
    expect(sb.from).not.toHaveBeenCalled();
    expect(sb.rpc).not.toHaveBeenCalled();
  });
  it("reserves the saved owner's snapshot, and rejects stale context before the RPC", async () => {
    const filters: unknown[][] = [];
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => {
        filters.push(args);
        return query;
      },
      maybeSingle: async () => ({
        data: {
          url: project.url,
          profile: project.profile,
          meta: {
            facts: project.facts,
            workspace: project.workspace,
            memory: project.memory,
          },
        },
        error: null,
      }),
    };
    const rpc = vi.fn(async (_name, args) => ({
      data: { ...row, payload: args.p_payload },
      error: null,
    }));
    const sb = { from: () => query, rpc } as unknown as SupabaseClient;
    const command = {
      action: "start" as const,
      projectId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      provider: "openai" as const,
      input: research.input,
      contextKey: research.contextKey,
      deepseekConsent: false,
    };
    await expect(reserveAgentRun(sb, "owner", command)).resolves.toHaveProperty(
      "id",
      row.id
    );
    expect(filters).toContainEqual(["user_id", "owner"]);
    expect(rpc).toHaveBeenCalledTimes(1);
    await expect(
      reserveAgentRun(sb, "owner", { ...command, contextKey: "stale" })
    ).rejects.toThrow("differ");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
