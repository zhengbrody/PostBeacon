import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { DEMO_PROJECT } from "@/lib/demo";

const seams = vi.hoisted(() => ({ guard: vi.fn(), llm: vi.fn() }));
vi.mock("@/lib/usage", () => ({ guardRoute: seams.guard }));
vi.mock("@/lib/llm", () => ({ generateJsonOnce: seams.llm }));
import { POST } from "@/app/api/weekly-task/route";
import { trialProductFacts } from "@/lib/opportunityResearch";

const factId = trialProductFacts(DEMO_PROJECT.facts)[0].id;
const proposal = (extra: Record<string, unknown> = {}) => ({
  kind: "product-improvement",
  title: "Add a sample project to the empty state",
  rationale: "The first screen is empty, so visitors cannot see the product.",
  factIds: [factId],
  minimalScope: ["Show one read-only sample"],
  acceptance: ["A signed-out visitor sees the sample"],
  tests: ["Cover the empty state"],
  assumptions: [],
  nonGoals: [],
  unknowns: [],
  ...extra,
});
const body = (extra: Record<string, unknown> = {}) => ({
  provider: "openai",
  profile: DEMO_PROJECT.profile,
  facts: DEMO_PROJECT.facts,
  intake: {
    pain: "Visitors do not know what to do first",
    successSignal: "Three people finish the first task",
    hoursAvailable: 4,
  },
  ...extra,
});
function request(payload: unknown, origin = "https://postbeacon.app") {
  return new NextRequest("https://postbeacon.app/api/weekly-task", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(payload),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  seams.guard.mockResolvedValue({ userId: "owner" });
  seams.llm.mockResolvedValue({
    data: { proposal: proposal() },
    meta: { provider: "openai", model: "test-model" },
  });
});

describe("weekly task route: spend, identity and grounding boundary", () => {
  it("returns one validated proposal for a signed-in owner with exactly one model request", async () => {
    const response = await POST(request(body()));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const data = await response.json();
    expect(data.proposal.factIds).toEqual([factId]);
    expect(data.meta.provider).toBe("openai");
    expect(seams.llm).toHaveBeenCalledTimes(1);
    // Only verified claims and the three inputs reach the model: no ids of other
    // users, no whole profile, no unverified/inferred facts.
    const sent = JSON.parse(seams.llm.mock.calls[0][0].user);
    expect(Object.keys(sent).sort()).toEqual(
      ["claimsNeverToUse", "growthGoal", "product", "thisWeek", "verifiedFacts"].sort()
    );
    const verifiedIds = trialProductFacts(DEMO_PROJECT.facts).map((fact) => fact.id);
    expect(sent.verifiedFacts.map((fact: { id: string }) => fact.id)).toEqual(verifiedIds);
  });
  it("makes no model call when signed out, keyless, cross-origin or rate-limited", async () => {
    seams.guard.mockResolvedValueOnce({
      response: NextResponse.json({ error: "Sign in", code: "auth" }, { status: 401 }),
    });
    expect((await POST(request(body()))).status).toBe(401);
    seams.guard.mockResolvedValueOnce({ userId: null }); // historical keyless mode
    expect((await POST(request(body()))).status).toBe(503);
    expect((await POST(request(body(), "https://evil.example"))).status).toBe(403);
    seams.guard.mockResolvedValueOnce({
      response: NextResponse.json({ error: "limit", code: "limit" }, { status: 429 }),
    });
    expect((await POST(request(body()))).status).toBe(429);
    expect(seams.llm).not.toHaveBeenCalled();
  });
  it("rejects malformed input and non-OpenAI providers before any model call", async () => {
    for (const bad of [
      body({ provider: "deepseek" }),
      body({ provider: "claude" }),
      body({ intake: { pain: "x", successSignal: "y", hoursAvailable: 4 } }),
      body({
        intake: {
          pain: "long enough pain",
          successSignal: "long enough",
          hoursAvailable: 900,
        },
      }),
      { provider: "openai" },
    ])
      expect((await POST(request(bad))).status).toBe(400);
    expect(seams.llm).not.toHaveBeenCalled();
  });
  it("discards output that is ungrounded, names files or is not a proposal", async () => {
    for (const data of [
      { proposal: proposal({ factIds: ["invented"] }) },
      { proposal: proposal({ title: "Refactor src/app/page.tsx" }) },
      { proposal: null },
      "not json at all",
    ]) {
      seams.llm.mockResolvedValueOnce({ data, meta: { provider: "openai", model: "m" } });
      const response = await POST(request(body()));
      expect(response.status).toBe(502);
      expect((await response.json()).error).toMatch(/unchanged/);
    }
  });
  it("says which rule discarded the proposal", async () => {
    const reply = async (data: unknown) => {
      seams.llm.mockResolvedValueOnce({ data, meta: { provider: "openai", model: "m" } });
      return (await (await POST(request(body()))).json()).error as string;
    };
    expect(await reply({ proposal: proposal({ tests: ["Update package.json"] }) })).toMatch(
      /files or code that PostBeacon has not read/
    );
    expect(await reply({ proposal: proposal({ factIds: [] }) })).toMatch(
      /No grounded proposal/
    );
    // A framework name is not a file reference.
    seams.llm.mockResolvedValueOnce({
      data: { proposal: proposal({ title: "Add a Next.js starter example" }) },
      meta: { provider: "openai", model: "m" },
    });
    expect((await POST(request(body()))).status).toBe(200);
  });
  it("accepts a learn-first proposal without facts when it states the unknowns", async () => {
    seams.llm.mockResolvedValueOnce({
      data: {
        proposal: proposal({
          kind: "validate-demand",
          factIds: [],
          unknowns: ["Whether anyone has this pain"],
        }),
      },
      meta: { provider: "openai", model: "m" },
    });
    const data = await (await POST(request(body({ facts: [] })))).json();
    expect(data.proposal.kind).toBe("validate-demand");
    expect(data.proposal.unknowns).toHaveLength(1);
  });
  it("reports a provider failure without leaking details", async () => {
    seams.llm.mockRejectedValueOnce(new Error("sk-secret upstream stack"));
    const response = await POST(request(body()));
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(await response.json())).not.toContain("sk-secret");
  });
});
