import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bufferGraphql,
  exchangeBufferCode,
  refreshBufferTokens,
  readBufferAccount,
} from "@/lib/bufferProvider";
import { BUFFER_SCOPES } from "@/lib/bufferConfig";

const request = vi.fn();
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const tokens = {
  access_token: "fictional-access",
  refresh_token: "fictional-refresh",
  token_type: "Bearer",
  expires_in: 3600,
  scope: BUFFER_SCOPES.join(" "),
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", request);
  vi.stubEnv("BUFFER_PUBLISHING_ENABLED", "true");
  vi.stubEnv("BUFFER_CLIENT_ID", "client");
  vi.stubEnv("BUFFER_CLIENT_SECRET", "fictional-secret");
  vi.stubEnv("BUFFER_REDIRECT_URI", "https://postbeacon.app/api/buffer/callback");
  vi.stubEnv("BUFFER_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  request.mockImplementation(async () => response(tokens));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("fixed-endpoint Buffer OAuth and GraphQL transport", () => {
  it("exchanges once with private-client PKCE and an exact registered redirect", async () => {
    const result = await exchangeBufferCode("fictional-code", "fictional-verifier");
    expect(result.accessToken).toBe("fictional-access");
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://auth.buffer.com/token");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(Object.fromEntries(init.body)).toEqual({
      client_id: "client",
      client_secret: "fictional-secret",
      grant_type: "authorization_code",
      code: "fictional-code",
      code_verifier: "fictional-verifier",
      redirect_uri: "https://postbeacon.app/api/buffer/callback",
    });
  });
  it("requires initial scopes and rejects explicit scope reduction while allowing inherited refresh scope", async () => {
    request.mockImplementation(async () => response({ ...tokens, scope: undefined }));
    await expect(exchangeBufferCode("code", "verifier")).rejects.toMatchObject({
      status: 409,
    });
    await expect(refreshBufferTokens("refresh")).resolves.toMatchObject({
      refreshToken: "fictional-refresh",
    });
    request.mockImplementation(async () => response({ ...tokens, scope: "account:read" }));
    await expect(refreshBufferTokens("refresh")).rejects.toMatchObject({ status: 409 });
    request.mockImplementation(async () => response({ ...tokens, scope: "" }));
    await expect(refreshBufferTokens("refresh")).rejects.toMatchObject({ status: 409 });
  });
  it.each([401, 403, 429, 500])(
    "does not retry or expose provider errors for HTTP %i",
    async (status) => {
      request.mockImplementation(async () =>
        response({ error_description: "private token=fictional-secret" }, status)
      );
      await expect(exchangeBufferCode("code", "verifier")).rejects.not.toThrow(
        "fictional-secret"
      );
      expect(request).toHaveBeenCalledOnce();
    }
  );
  it("keeps the GraphQL endpoint fixed and rejects partial error responses", async () => {
    request.mockImplementation(async () =>
      response({ data: { post: { id: "fictional-post" } } })
    );
    expect(await bufferGraphql("access", "query { post { id } }", {})).toEqual({
      post: { id: "fictional-post" },
    });
    expect(request.mock.calls[0][0]).toBe("https://api.buffer.com");
    expect(request.mock.calls[0][1].headers.Authorization).toBe("Bearer access");
    request.mockImplementation(async () =>
      response({ errors: [{ message: "private" }], data: { post: {} } })
    );
    await expect(bufferGraphql("access", "query { post { id } }")).rejects.not.toThrow(
      "private"
    );
  });
  it("fails before provider calls when disabled or configuration is incomplete", async () => {
    vi.stubEnv("BUFFER_PUBLISHING_ENABLED", "false");
    await expect(bufferGraphql("access", "query { account { id } }")).rejects.toMatchObject(
      { status: 503 }
    );
    await expect(refreshBufferTokens("refresh")).rejects.toMatchObject({ status: 503 });
    expect(request).not.toHaveBeenCalled();
  });
  it("caps response bytes and does not expose malformed response text", async () => {
    request.mockImplementation(async () => new Response("x".repeat(131073)));
    await expect(exchangeBufferCode("code", "verifier")).rejects.toMatchObject({
      status: 502,
    });
    request.mockImplementation(async () => new Response("private upstream invalid json"));
    await expect(exchangeBufferCode("code", "verifier")).rejects.not.toThrow(
      "private upstream"
    );
  });
  it("applies the deadline to a response body, not only initial headers", async () => {
    vi.useFakeTimers();
    request.mockImplementation(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal.addEventListener("abort", () =>
                controller.error(new Error("aborted"))
              );
            },
          })
        )
    );
    const assertion = expect(exchangeBufferCode("code", "verifier")).rejects.toMatchObject({
      status: 502,
    });
    await vi.advanceTimersByTimeAsync(12001);
    await assertion;
    expect(request).toHaveBeenCalledOnce();
  });
});
describe("bounded server-derived Buffer channel metadata", () => {
  it("queries no email and returns only supported connected/unlocked channels", async () => {
    request.mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.query.includes("account {"))
        return response({
          data: {
            account: {
              id: "account",
              organizations: [{ id: "org", name: "Fictional workspace" }],
            },
          },
        });
      return response({
        data: {
          channels: [
            {
              id: "x",
              name: "X",
              service: "twitter",
              isDisconnected: false,
              isLocked: false,
            },
            {
              id: "li",
              name: "LinkedIn",
              service: "linkedin",
              isDisconnected: false,
              isLocked: false,
            },
            {
              id: "locked",
              name: "Locked",
              service: "twitter",
              isDisconnected: false,
              isLocked: true,
            },
            {
              id: "off",
              name: "Disconnected",
              service: "twitter",
              isDisconnected: true,
              isLocked: false,
            },
            {
              id: "ig",
              name: "Instagram",
              service: "instagram",
              isDisconnected: false,
              isLocked: false,
            },
          ],
        },
      });
    });
    const beforeRead = vi.fn().mockResolvedValue(undefined);
    const metadata = await readBufferAccount("access", beforeRead);
    expect(metadata.channels.map((row) => row.id)).toEqual(["x", "li"]);
    expect(metadata.channels.every((row) => row.organizationId === "org")).toBe(true);
    expect(
      request.mock.calls.every((call) => !JSON.parse(call[1].body).query.includes("email"))
    ).toBe(true);
    expect(JSON.parse(request.mock.calls[1][1].body).query).toContain("OrganizationId!");
    expect(beforeRead).toHaveBeenCalledTimes(2);
    expect(beforeRead.mock.invocationCallOrder[1]).toBeLessThan(
      request.mock.invocationCallOrder[1]
    );
  });
  it("fences every new provider read and stops after connection revocation", async () => {
    request.mockImplementation(async () =>
      response({
        data: {
          account: {
            id: "account",
            organizations: [{ id: "org", name: "Fictional workspace" }],
          },
        },
      })
    );
    const fence = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("connection changed"));
    await expect(readBufferAccount("access", fence)).rejects.toThrow("connection changed");
    expect(request).toHaveBeenCalledOnce();
  });
  it("rejects accounts beyond the pilot bound rather than silently truncating", async () => {
    request.mockImplementation(async () =>
      response({
        data: {
          account: {
            id: "account",
            organizations: Array.from({ length: 5 }, (_, i) => ({
              id: String(i),
              name: "workspace",
            })),
          },
        },
      })
    );
    await expect(readBufferAccount("access")).rejects.toMatchObject({ status: 502 });
    expect(request).toHaveBeenCalledOnce();
  });
});
