import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const seam = vi.hoisted(() => ({
  user: vi.fn(),
  store: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  pause: vi.fn(),
  reserve: vi.fn(),
  due: vi.fn(),
  execute: vi.fn(),
  after: vi.fn(),
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: seam.after,
}));
vi.mock("@/lib/usage", () => ({ getUserFromRequest: seam.user }));
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: seam.store }));
vi.mock("@/lib/agentMissionServer", async (original) => ({
  ...(await original<typeof import("@/lib/agentMissionServer")>()),
  readAgentMission: seam.read,
  saveAgentMission: seam.save,
  pauseAgentMission: seam.pause,
  reserveAgentMissionRun: seam.reserve,
  reserveDueAgentMissions: seam.due,
}));
vi.mock("@/lib/agentRunServer", () => ({ executeAgentRun: seam.execute }));
import { GET, POST } from "@/app/api/agent-missions/route";
import { GET as tick } from "@/app/api/agent-missions/tick/route";
import { PublicError } from "@/lib/errors";
const projectId = "123e4567-e89b-42d3-a456-426614174000";
const request = (body: unknown, origin = "https://postbeacon.app") =>
  new NextRequest("https://postbeacon.app/api/agent-missions", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  for (const name of ["AGENT_RUNS_ENABLED", "AGENT_MISSIONS_ENABLED"])
    vi.stubEnv(name, "true");
  vi.stubEnv("OPENAI_API_KEY", "test");
  vi.stubEnv("SEARCH_API_KEY", "test");
  vi.stubEnv("CRON_SECRET", "operator-secret");
  seam.user.mockResolvedValue({ id: "owner" });
  seam.store.mockReturnValue({});
  seam.read.mockResolvedValue({ id: "mission", revision: 1 });
});
afterEach(() => vi.unstubAllEnvs());
describe("daily mission HTTP authorization", () => {
  it("does not claim an authorization is absent when storage credentials are missing", async () => {
    vi.stubEnv("AGENT_MISSIONS_ENABLED", "false");
    seam.store.mockReturnValue(null);
    const response = await GET(
      new NextRequest(`https://postbeacon.app/api/agent-missions?projectId=${projectId}`)
    );
    expect(response.status).toBe(503);
    expect(seam.read).not.toHaveBeenCalled();
  });
  it("rejects foreign origin before identity/storage and anonymous callers before flags", async () => {
    expect((await POST(request({}, "https://foreign.example"))).status).toBe(403);
    expect(seam.user).not.toHaveBeenCalled();
    expect(seam.store).not.toHaveBeenCalled();
    seam.user.mockResolvedValue(null);
    vi.stubEnv("AGENT_MISSIONS_ENABLED", "false");
    expect(
      (
        await GET(
          new NextRequest(
            `https://postbeacon.app/api/agent-missions?projectId=${projectId}`
          )
        )
      ).status
    ).toBe(401);
  });
  it("shows existing authorization even when flags/keys are off and allows pause", async () => {
    vi.stubEnv("AGENT_MISSIONS_ENABLED", "false");
    vi.stubEnv("SEARCH_API_KEY", "");
    const read = await GET(
      new NextRequest(`https://postbeacon.app/api/agent-missions?projectId=${projectId}`)
    );
    expect(await read.json()).toEqual({
      enabled: false,
      mission: { id: "mission", revision: 1 },
    });
    seam.pause.mockResolvedValue({ id: "mission", enabled: false });
    expect((await POST(request({ action: "pause", projectId }))).status).toBe(200);
    expect(seam.pause).toHaveBeenCalledWith({}, "owner", projectId);
    expect(seam.after).not.toHaveBeenCalled();
  });
  it("does not hide unreadable installed data with a disabled flag", async () => {
    vi.stubEnv("AGENT_MISSIONS_ENABLED", "false");
    seam.read.mockRejectedValue(new PublicError("Installation unreadable.", 503));
    expect(
      (
        await GET(
          new NextRequest(
            `https://postbeacon.app/api/agent-missions?projectId=${projectId}`
          )
        )
      ).status
    ).toBe(503);
  });
  it("only schedules an actual queued reservation, with owner and expected revision", async () => {
    seam.reserve.mockResolvedValue({ id: "run", status: "queued" });
    const response = await POST(
      request({
        action: "run-now",
        projectId,
        expectedRevision: 1,
        contextKey: "saved-context",
      })
    );
    expect(response.status).toBe(200);
    expect(seam.reserve).toHaveBeenCalledWith(
      {},
      "owner",
      { id: "mission", revision: 1 },
      "saved-context",
      1
    );
    expect(seam.execute).not.toHaveBeenCalled();
    await seam.after.mock.calls[0][0]();
    expect(seam.execute).toHaveBeenCalledWith({}, "owner", "run");
    seam.after.mockClear();
    seam.reserve.mockResolvedValue({ id: "run", status: "ready" });
    await POST(
      request({
        action: "run-now",
        projectId,
        expectedRevision: 1,
        contextKey: "saved-context",
      })
    );
    expect(seam.after).not.toHaveBeenCalled();
  });
  it("rejects forged output, missing revision and disabled starts before workers", async () => {
    expect(
      (await POST(request({ action: "complete", projectId, research: {} }))).status
    ).toBe(400);
    expect(
      (await POST(request({ action: "run-now", projectId, contextKey: "saved-context" })))
        .status
    ).toBe(400);
    vi.stubEnv("AGENT_MISSIONS_ENABLED", "false");
    expect(
      (
        await POST(
          request({
            action: "run-now",
            projectId,
            expectedRevision: 1,
            contextKey: "saved-context",
          })
        )
      ).status
    ).toBe(503);
    expect(seam.reserve).not.toHaveBeenCalled();
    expect(seam.after).not.toHaveBeenCalled();
  });
});
describe("bounded operator dispatcher", () => {
  const tickRequest = (secret?: string) =>
    new NextRequest("https://postbeacon.app/api/agent-missions/tick", {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    });
  it("requires configured cron authentication before dispatch or storage", async () => {
    expect((await tick(tickRequest("wrong"))).status).toBe(401);
    expect(seam.store).not.toHaveBeenCalled();
    vi.stubEnv("CRON_SECRET", "");
    expect((await tick(tickRequest())).status).toBe(503);
    expect(seam.due).not.toHaveBeenCalled();
  });
  it("does not dispatch when feature or paid services are unavailable", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await (await tick(tickRequest("operator-secret"))).json()).toEqual({
      enabled: false,
      reserved: 0,
      skipped: 0,
    });
    expect(seam.due).not.toHaveBeenCalled();
  });
  it("responds only with aggregate counts, keeps workers after reserved receipt", async () => {
    seam.due.mockResolvedValue({
      reserved: [
        { id: "run-a", userId: "owner-a" },
        { id: "run-b", userId: "owner-b" },
      ],
      skipped: 1,
    });
    const response = await tick(tickRequest("operator-secret"));
    expect(await response.json()).toEqual({ enabled: true, reserved: 2, skipped: 1 });
    expect(seam.execute).not.toHaveBeenCalled();
    await seam.after.mock.calls[0][0]();
    expect(seam.execute).toHaveBeenCalledWith({}, "owner-a", "run-a");
    expect(seam.execute).toHaveBeenCalledWith({}, "owner-b", "run-b");
  });
});
