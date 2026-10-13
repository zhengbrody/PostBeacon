import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/opportunities/route";
import { POST as copilotPost } from "@/app/api/copilot/route";
import { DEMO_PROJECT } from "@/lib/demo";

const seams = vi.hoisted(() => ({ guard: vi.fn(), research: vi.fn(), copilot: vi.fn() }));
vi.mock("@/lib/usage", () => ({ guardRoute: seams.guard }));
vi.mock("@/lib/opportunityResearchServer", () => ({
  runOpportunityResearch: seams.research,
}));
vi.mock("@/lib/copilot", () => ({ runCopilot: seams.copilot }));
beforeEach(() => {
  vi.clearAllMocks();
  seams.guard.mockResolvedValue({ userId: "owner" });
  seams.research.mockResolvedValue({ id: "safe-output" });
  seams.copilot.mockResolvedValue({ reply: "", actions: [], blocked: 0 });
});
function request(body: unknown, origin = "https://postbeacon.app") {
  return new NextRequest("https://postbeacon.app/api/opportunities", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
}
describe("research route spend/privacy boundary", () => {
  it("passes a valid signed-in request once with no-store and no caller-controlled identity", async () => {
    const response = await POST(
      request({
        provider: "openai",
        productUrl: "https://acme.example",
        profile: DEMO_PROJECT.profile,
        facts: [
          {
            id: "feature",
            field: "features",
            claim: "Acme checks jobs",
            status: "user-confirmed",
            sourceType: "user",
            confidence: 1,
          },
        ],
        successContract: {
          primaryGoal: "Useful feedback",
          primarySignal: "replies",
          minimumResult: 2,
          evaluationWindow: "72h",
        },
        input: {
          audience: "Developers",
          task: "Check a job",
          entryUrl: "https://acme.example/demo",
          platformId: "twitter",
          venue: "Own X profile",
          steps: ["Open the demo", "Check the sample", "Share feedback"],
          feedbackQuestion: "What was confusing?",
          sources: [
            {
              url: "https://example.org/need",
              quote: "How can a developer check whether a job ran?",
              fetchAllowed: false,
            },
          ],
        },
        bannedClaims: ["guaranteed results"],
        userId: "another-owner",
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(seams.research).toHaveBeenCalledOnce();
    expect(seams.research.mock.calls[0][0]).not.toHaveProperty("userId");
    expect(seams.research.mock.calls[0][0].bannedClaims).toEqual(["guaranteed results"]);
  });
  it("rejects cross-origin requests before auth, scrape or model", async () => {
    expect((await POST(request({}, "https://evil.example"))).status).toBe(403);
    expect(seams.guard).not.toHaveBeenCalled();
    expect(seams.research).not.toHaveBeenCalled();
  });
  it("propagates auth/rate caps before body parsing or research", async () => {
    seams.guard.mockResolvedValue({
      response: NextResponse.json({ error: "Sign in" }, { status: 401 }),
    });
    expect((await POST(request({}))).status).toBe(401);
    expect(seams.research).not.toHaveBeenCalled();
    seams.guard.mockResolvedValue({
      response: NextResponse.json({ error: "Cap" }, { status: 429 }),
    });
    expect((await POST(request({}))).status).toBe(429);
  });
  it("fails closed without configured accounts; legacy keyless mode is not inherited", async () => {
    seams.guard.mockResolvedValue({ userId: null });
    expect((await POST(request({}))).status).toBe(503);
    expect(seams.research).not.toHaveBeenCalled();
  });
  it("bounded validation errors never echo submitted content", async () => {
    const response = await POST(
      request({ provider: "claude", secret: "private-user-content" })
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private-user-content");
    expect(seams.research).not.toHaveBeenCalled();
  });
  it("rejects oversized payload before research", async () => {
    expect((await POST(request({ body: "x".repeat(64_001) }))).status).toBe(413);
    expect(seams.research).not.toHaveBeenCalled();
  });
  it("preserves the bound draft index through the actual Copilot route", async () => {
    const response = await copilotPost(
      request({
        provider: "openai",
        profile: DEMO_PROJECT.profile,
        strategy: DEMO_PROJECT.strategy,
        result: DEMO_PROJECT.result,
        facts: [],
        action: "rewrite",
        targetPlatformId: "twitter",
        targetPostIdx: 0,
      })
    );
    expect(response.status).toBe(200);
    expect(seams.copilot.mock.calls[0][0].targetPostIdx).toBe(0);
  });
});
