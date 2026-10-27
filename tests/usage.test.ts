import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({
  auth: true,
  configured: true,
  billing: true,
  metering: true,
  store: true,
  rpc: vi.fn(),
  read: vi.fn(),
  upsert: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  authConfigured: () => seams.auth,
  authConfigurationPresent: () => seams.configured,
  meteringEnabled: () => seams.metering,
  billingEnabled: () => seams.billing,
  getTokenVerifier: () => ({ auth: { getUser: seams.getUser } }),
  getServiceSupabase: () =>
    seams.store
      ? {
          rpc: seams.rpc,
          from: () => ({
            select: () => ({ eq: () => ({ maybeSingle: seams.read }) }),
            upsert: seams.upsert,
          }),
        }
      : null,
}));
import { getEntitlement, guardRoute, incrementLaunch, setPlan } from "@/lib/usage";
import { GET as usageRoute } from "@/app/api/usage/route";

const uid = "00000000-0000-4000-8000-000000000001";
const request = () =>
  new NextRequest("https://postbeacon.app/api/analyze", {
    headers: { Authorization: "Bearer test-only" },
  });
beforeEach(() => {
  vi.clearAllMocks();
  seams.auth = seams.configured = seams.metering = seams.store = seams.billing = true;
  seams.getUser.mockResolvedValue({ data: { user: { id: uid } } });
  seams.rpc.mockResolvedValue({ data: true, error: null });
  seams.read.mockResolvedValue({ data: { plan: "free", launches_used: 2 }, error: null });
  seams.upsert.mockResolvedValue({ error: null });
});

describe("atomic server-owned usage", () => {
  it("reserves a daily call in one atomic RPC rather than read/modify/upsert", async () => {
    expect(await guardRoute(request())).toEqual({ userId: uid });
    expect(seams.rpc).toHaveBeenCalledExactlyOnceWith("postbeacon_reserve_daily_call", {
      p_user_id: uid,
      p_limit: 30,
    });
    expect(seams.read).not.toHaveBeenCalled();
    expect(seams.upsert).not.toHaveBeenCalled();
  });
  it("returns 429 only for an explicit atomic budget rejection", async () => {
    seams.rpc.mockResolvedValue({ data: false, error: null });
    const guard = await guardRoute(request());
    expect("response" in guard && guard.response.status).toBe(429);
  });
  it.each([
    { data: null, error: { message: "secret database detail" } },
    { data: null, error: null },
    { data: "true", error: null },
  ])("fails closed for unreadable or malformed usage storage", async (result) => {
    seams.rpc.mockResolvedValue(result);
    await expect(guardRoute(request())).rejects.toMatchObject({ status: 503 });
    await expect(guardRoute(request())).rejects.not.toThrow("secret database detail");
  });
  it("does not treat a configured but missing store as unlimited", async () => {
    seams.store = false;
    await expect(guardRoute(request())).rejects.toMatchObject({ status: 503 });
  });
  it("preserves unconfigured keyless and unmetered beta behavior", async () => {
    seams.auth = false;
    seams.metering = false;
    seams.configured = false;
    expect(await guardRoute(request())).toEqual({ userId: null });
    seams.auth = true;
    seams.configured = true;
    seams.metering = false;
    seams.store = false;
    expect(await guardRoute(request())).toEqual({ userId: uid });
    expect(seams.rpc).not.toHaveBeenCalled();
    expect(await getEntitlement(uid)).toEqual({ plan: "free", launchesUsed: 0 });
  });
  it("does not turn a partially configured authenticated deployment into an open API", async () => {
    seams.auth = false;
    seams.metering = false;
    await expect(guardRoute(request())).rejects.toMatchObject({ status: 503 });
    expect(seams.rpc).not.toHaveBeenCalled();
  });
  it("sanitizes thrown storage failures rather than leaking provider details", async () => {
    seams.rpc.mockRejectedValue(new Error("private upstream connection string"));
    await expect(guardRoute(request())).rejects.toMatchObject({ status: 503 });
    await expect(guardRoute(request())).rejects.not.toThrow("connection string");
  });
  it("increments successful-launch counts atomically without replacing plan or daily data", async () => {
    seams.rpc.mockResolvedValue({ data: 4, error: null });
    await incrementLaunch(uid);
    expect(seams.rpc).toHaveBeenCalledExactlyOnceWith("postbeacon_increment_launch", {
      p_user_id: uid,
    });
    expect(seams.read).not.toHaveBeenCalled();
    expect(seams.upsert).not.toHaveBeenCalled();
  });
  it("does not accept a failed or malformed launch counter write", async () => {
    seams.rpc.mockResolvedValue({ data: null, error: { message: "secret" } });
    await expect(incrementLaunch(uid)).rejects.toMatchObject({ status: 503 });
    seams.rpc.mockResolvedValue({ data: true, error: null });
    await expect(incrementLaunch(uid)).rejects.toMatchObject({ status: 503 });
  });
  it("distinguishes an absent entitlement from unreadable or malformed data", async () => {
    expect(await getEntitlement(uid)).toEqual({ plan: "free", launchesUsed: 2 });
    seams.read.mockResolvedValue({ data: null, error: null });
    expect(await getEntitlement(uid)).toEqual({ plan: "free", launchesUsed: 0 });
    seams.read.mockResolvedValue({ data: null, error: { message: "secret" } });
    await expect(getEntitlement(uid)).rejects.toMatchObject({ status: 503 });
    seams.read.mockResolvedValue({ data: { plan: "pro", launches_used: -1 }, error: null });
    await expect(getEntitlement(uid)).rejects.toMatchObject({ status: 503 });
  });
  it("rejects failed plan writes and unknown plans instead of acknowledging success", async () => {
    seams.upsert.mockResolvedValue({ error: { message: "secret" } });
    await expect(setPlan(uid, "pro")).rejects.toMatchObject({ status: 503 });
    expect(seams.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: uid, plan: "pro" }),
      { onConflict: "user_id" }
    );
    await expect(setPlan(uid, "invalid")).rejects.toMatchObject({ status: 400 });
  });
  it("keeps usage GET errors bounded and billing hidden during beta", async () => {
    seams.read.mockResolvedValue({ data: null, error: { message: "secret connection" } });
    const failed = await usageRoute(request());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({
      error: "Usage tracking is unavailable. Try again later.",
    });
    seams.billing = false;
    expect(await (await usageRoute(request())).json()).toEqual({ enabled: false });
  });
});
