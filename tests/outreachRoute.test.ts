import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { DEMO_PROJECT } from "@/lib/demo";

const seams = vi.hoisted(() => ({ guard: vi.fn(), llm: vi.fn() }));
vi.mock("@/lib/usage", () => ({ guardRoute: seams.guard }));
vi.mock("@/lib/llm", () => ({ generateJsonOnce: seams.llm }));
import { POST } from "@/app/api/outreach/route";
import { trialProductFacts } from "@/lib/opportunityResearch";
import { OUTREACH_BUDGET } from "@/lib/outreachServer";

const body = (extra: Record<string, unknown> = {}) => ({
  provider: "openai",
  profile: DEMO_PROJECT.profile,
  facts: DEMO_PROJECT.facts,
  productUrl: "https://example.com",
  people: [
    { alias: "c1", need: "Cannot tell which channel to try first" },
    { alias: "c2", need: "Spends hours writing launch posts" },
  ],
  ...extra,
});
function request(payload: unknown, origin = "https://postbeacon.app") {
  return new NextRequest("https://postbeacon.app/api/outreach", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(payload),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  seams.guard.mockResolvedValue({ userId: "owner" });
  seams.llm.mockResolvedValue({
    data: {
      messages: [
        {
          id: "c1",
          message: "You said picking a channel is hard. I built this.",
          factIds: [],
        },
        { id: "c5", message: "Nobody asked for this one", factIds: [] },
      ],
    },
    meta: { provider: "openai", model: "test-model" },
  });
});

describe("outreach route: spend, identity and privacy boundary", () => {
  it("drafts the whole batch with exactly one bounded model request", async () => {
    const response = await POST(request(body()));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const data = await response.json();
    // A message for someone who was not in the request is dropped.
    expect(data.drafts.map((d: { alias: string }) => d.alias)).toEqual(["c1"]);
    expect(seams.llm).toHaveBeenCalledTimes(1);
    const call = seams.llm.mock.calls[0][0];
    expect(call.provider).toBe("openai");
    expect(call.maxTokens).toBe(OUTREACH_BUDGET.maxTokens);
    const sent = JSON.parse(call.user);
    expect(Object.keys(sent).sort()).toEqual(
      [
        "claimsNeverToUse",
        "goal",
        "people",
        "product",
        "productUrl",
        "verifiedFacts",
      ].sort()
    );
    expect(sent.people).toEqual([
      { id: "c1", need: "Cannot tell which channel to try first" },
      { id: "c2", need: "Spends hours writing launch posts" },
    ]);
    const verified = trialProductFacts(DEMO_PROJECT.facts).map((f) => f.id);
    expect(sent.verifiedFacts.map((f: { id: string }) => f.id)).toEqual(
      verified.slice(0, OUTREACH_BUDGET.facts)
    );
    expect(call.user.length).toBeLessThan(6000);
  });

  it("never sends the goal's target number or window to the model", async () => {
    await POST(
      request(
        body({
          successContract: {
            primaryGoal: "Get replies from founders",
            primarySignal: "replies",
            minimumResult: 7,
            evaluationWindow: "72h",
          },
        })
      )
    );
    const sent = JSON.parse(seams.llm.mock.calls[0][0].user);
    expect(sent.goal).toEqual({ goal: "Get replies from founders", signal: "replies" });
  });

  it("requires a signed-in owner and spends nothing otherwise", async () => {
    seams.guard.mockResolvedValue({ userId: null });
    expect((await POST(request(body()))).status).toBe(503);
    seams.guard.mockResolvedValue({
      response: NextResponse.json({ error: "limit" }, { status: 429 }),
    });
    expect((await POST(request(body()))).status).toBe(429);
    expect(seams.llm).not.toHaveBeenCalled();
  });

  it("refuses another origin before checking the account", async () => {
    expect((await POST(request(body(), "https://evil.example"))).status).toBe(403);
    expect(seams.guard).not.toHaveBeenCalled();
  });

  it("refuses a body that carries more than a need per person, or another provider", async () => {
    for (const bad of [
      body({ provider: "deepseek" }),
      body({ people: [] }),
      body({ people: [{ alias: "real-id", need: "Cannot tell which channel" }] }),
      body({
        people: Array.from({ length: 6 }, () => ({ alias: "c1", need: "long enough" })),
      }),
    ])
      expect((await POST(request(bad))).status).toBe(400);
    expect(seams.llm).not.toHaveBeenCalled();
  });

  it("spends nothing when no product fact is verified", async () => {
    const response = await POST(
      request(
        body({ facts: DEMO_PROJECT.facts.map((f) => ({ ...f, status: "inferred" })) })
      )
    );
    expect(response.status).toBe(400);
    expect(seams.llm).not.toHaveBeenCalled();
  });

  it("says so when nothing usable comes back", async () => {
    seams.llm.mockResolvedValue({
      data: { messages: [{ id: "c1", message: "Hi [Name]" }] },
      meta: { provider: "openai", model: "test-model" },
    });
    const response = await POST(request(body()));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("unchanged");
  });
});
