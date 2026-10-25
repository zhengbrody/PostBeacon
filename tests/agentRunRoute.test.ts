import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const seam = vi.hoisted(() => ({
  user: vi.fn(),
  store: vi.fn(),
  reserve: vi.fn(),
  execute: vi.fn(),
  transition: vi.fn(),
  after: vi.fn(),
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: seam.after,
}));
vi.mock("@/lib/usage", () => ({ getUserFromRequest: seam.user }));
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: seam.store }));
vi.mock("@/lib/agentRunServer", async (original) => ({
  ...(await original<typeof import("@/lib/agentRunServer")>()),
  reserveAgentRun: seam.reserve,
  executeAgentRun: seam.execute,
  transitionAgentRun: seam.transition,
}));
import { GET, POST } from "@/app/api/agent-runs/route";
import { DEMO_PROJECT } from "@/lib/demo";
import { exampleOpportunityResearch } from "@/lib/opportunityResearch";

const projectId = "123e4567-e89b-42d3-a456-426614174000";
const request = (body: unknown, origin = "https://postbeacon.app") =>
  new NextRequest("https://postbeacon.app/api/agent-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AGENT_RUNS_ENABLED", "true");
  seam.user.mockResolvedValue({ id: "owner" });
  seam.store.mockReturnValue({});
});
afterEach(() => vi.unstubAllEnvs());

describe("Agent route fail-closed boundary", () => {
  it("schedules only after durable reservation and returns without claiming completion", async () => {
    const input = exampleOpportunityResearch(
      DEMO_PROJECT.profile,
      DEMO_PROJECT.facts,
      {
        primaryGoal: "Feedback",
        primarySignal: "replies",
        minimumResult: 2,
        evaluationWindow: "72h",
      },
      DEMO_PROJECT.url
    ).input;
    seam.reserve.mockResolvedValue({ id: projectId, status: "queued" });
    const body = {
      action: "start",
      projectId,
      requestId: crypto.randomUUID(),
      provider: "openai",
      input,
      contextKey: "context",
      deepseekConsent: false,
    };
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: projectId, status: "queued" });
    expect(seam.reserve).toHaveBeenCalledWith({}, "owner", body);
    expect(seam.execute).not.toHaveBeenCalled();
    await seam.after.mock.calls[0][0]();
    expect(seam.execute).toHaveBeenCalledWith({}, "owner", projectId);
  });
  it("rejects foreign origins before authentication, storage or workers", async () => {
    expect((await POST(request({}, "https://foreign.example"))).status).toBe(403);
    expect(seam.user).not.toHaveBeenCalled();
    expect(seam.store).not.toHaveBeenCalled();
    expect(seam.after).not.toHaveBeenCalled();
  });
  it("requires a verified identity even with the flag off", async () => {
    vi.stubEnv("AGENT_RUNS_ENABLED", "false");
    seam.user.mockResolvedValue(null);
    expect((await POST(request({}))).status).toBe(401);
    expect(
      (
        await GET(
          new NextRequest(`https://postbeacon.app/api/agent-runs?projectId=${projectId}`)
        )
      ).status
    ).toBe(401);
    expect(seam.store).not.toHaveBeenCalled();
  });
  it("discloses disabled setup without calling storage or a model", async () => {
    vi.stubEnv("AGENT_RUNS_ENABLED", "false");
    const response = await GET(
      new NextRequest(`https://postbeacon.app/api/agent-runs?projectId=${projectId}`)
    );
    expect(await response.json()).toEqual({ enabled: false, runs: [] });
    expect((await POST(request({}))).status).toBe(503);
    expect(seam.store).not.toHaveBeenCalled();
    expect(seam.after).not.toHaveBeenCalled();
  });
  it("refuses storage failure and forged completion, never scheduling work", async () => {
    seam.store.mockReturnValueOnce(null);
    expect((await POST(request({}))).status).toBe(503);
    expect((await POST(request({ action: "complete", runId: projectId }))).status).toBe(
      400
    );
    expect(seam.after).not.toHaveBeenCalled();
  });
  it("uses the verified owner's identity for cancellation, not a caller-supplied id", async () => {
    seam.transition.mockResolvedValue(null);
    expect((await POST(request({ action: "cancel", runId: projectId }))).status).toBe(404);
    expect(seam.transition).toHaveBeenCalledWith({}, "owner", projectId, "cancel");
    expect(seam.execute).not.toHaveBeenCalled();
  });
});
