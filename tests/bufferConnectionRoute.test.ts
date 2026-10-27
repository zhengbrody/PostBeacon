import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({
  user: vi.fn(),
  store: vi.fn(),
  list: vi.fn(),
  begin: vi.fn(),
  finish: vi.fn(),
  refresh: vi.fn(),
  disconnect: vi.fn(),
  stage: vi.fn(),
}));
vi.mock("@/lib/usage", () => ({ getUserFromRequest: calls.user }));
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase: calls.store }));
vi.mock("@/lib/bufferConnectionServer", () => ({
  BUFFER_BINDING_COOKIE: "__Host-postbeacon-buffer",
  bufferConnectionList: calls.list,
  beginBufferConnection: calls.begin,
  finishBufferConnection: calls.finish,
  refreshBufferChannels: calls.refresh,
  disconnectBufferConnection: calls.disconnect,
  stageBufferCallback: calls.stage,
}));
import { GET, POST } from "@/app/api/buffer/connections/route";
import { GET as callback } from "@/app/api/buffer/callback/route";
const request = (body: unknown, origin = "https://postbeacon.app") =>
  new NextRequest(`${origin}/api/buffer/connections`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: "__Host-postbeacon-buffer=binding",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  calls.user.mockResolvedValue({ id: "owner" });
  calls.store.mockReturnValue({});
  calls.list.mockResolvedValue({ enabled: true, connection: null, setupIssues: [] });
  vi.stubEnv("BUFFER_PUBLISHING_ENABLED", "true");
  vi.stubEnv("BUFFER_CLIENT_ID", "client");
  vi.stubEnv("BUFFER_CLIENT_SECRET", "secret");
  vi.stubEnv("BUFFER_REDIRECT_URI", "https://postbeacon.app/api/buffer/callback");
  vi.stubEnv("BUFFER_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
});
afterEach(() => vi.unstubAllEnvs());
describe("Buffer connection HTTP boundaries", () => {
  it("rejects foreign origins and unsigned callers before configuration or commands", async () => {
    const foreign = new NextRequest("https://postbeacon.app/api/buffer/connections", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: "{}",
    });
    expect((await POST(foreign)).status).toBe(403);
    expect(calls.user).not.toHaveBeenCalled();
    calls.user.mockResolvedValue(null);
    expect(
      (await GET(new NextRequest("https://postbeacon.app/api/buffer/connections"))).status
    ).toBe(401);
  });
  it("keeps GET/disconnect available but other commands closed when flags or keys are off", async () => {
    vi.stubEnv("BUFFER_PUBLISHING_ENABLED", "false");
    vi.stubEnv("BUFFER_TOKEN_ENCRYPTION_KEY", "");
    expect(
      (await GET(new NextRequest("https://postbeacon.app/api/buffer/connections"))).status
    ).toBe(200);
    for (const action of ["connect", "finish", "refresh-channels"])
      expect((await POST(request({ action }))).status).toBe(503);
    expect((await POST(request({ action: "disconnect" }))).status).toBe(200);
    expect(calls.disconnect).toHaveBeenCalledOnce();
    expect(calls.begin).not.toHaveBeenCalled();
  });
  it("uses a secure host-only HttpOnly one-time binding cookie without exposing the verifier", async () => {
    calls.begin.mockResolvedValue({
      authorizationUrl: "https://auth.buffer.com/auth?state=public-random-state",
      binding: "browser-only-binding",
    });
    const response = await POST(request({ action: "connect" }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__Host-postbeacon-buffer=");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toContain("Path=/;");
    expect(cookie).not.toMatch(/Domain=/i);
    expect(JSON.stringify(await response.json())).not.toContain("browser-only-binding");
  });
  it("refuses www-started OAuth before state creation rather than broadening the cookie domain", async () => {
    expect(
      (await POST(request({ action: "connect" }, "https://www.postbeacon.app"))).status
    ).toBe(409);
    expect(calls.begin).not.toHaveBeenCalled();
  });
  it("finishes with the authenticated owner and HttpOnly binding, never a client-supplied owner", async () => {
    expect((await POST(request({ action: "finish", userId: "other-owner" }))).status).toBe(
      400
    );
    expect(calls.finish).not.toHaveBeenCalled();
    const response = await POST(request({ action: "finish" }));
    expect(response.status).toBe(200);
    expect(calls.finish).toHaveBeenCalledExactlyOnceWith({}, "owner", "binding");
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect(JSON.stringify(await response.json())).not.toContain("binding");
  });
  it("stages the provider callback without a bearer and redirects only to the fixed finish page", async () => {
    const response = await callback(
      new NextRequest(
        "https://postbeacon.app/api/buffer/callback?state=state&code=private-code&next=https://evil.example",
        { headers: { Cookie: "__Host-postbeacon-buffer=binding" } }
      )
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://postbeacon.app/app?buffer=finish"
    );
    expect(calls.stage).toHaveBeenCalledWith({}, "state", "binding", "private-code");
    expect(calls.user).not.toHaveBeenCalled();
    expect(calls.finish).not.toHaveBeenCalled();
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("does not reflect denied callback details or accept an alternate callback host", async () => {
    const denied = await callback(
      new NextRequest(
        "https://postbeacon.app/api/buffer/callback?error=private-provider-details&state=secret"
      )
    );
    expect(denied.headers.get("location")).toBe("https://postbeacon.app/app?buffer=error");
    expect(calls.stage).not.toHaveBeenCalled();
    const foreign = await callback(
      new NextRequest(
        "https://www.postbeacon.app/api/buffer/callback?code=code&state=state"
      )
    );
    expect(foreign.headers.get("location")).toBe("https://postbeacon.app/app?buffer=error");
    expect(calls.stage).not.toHaveBeenCalled();
  });
});
