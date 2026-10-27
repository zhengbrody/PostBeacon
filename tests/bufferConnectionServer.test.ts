import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const provider = vi.hoisted(() => ({
  exchange: vi.fn(),
  refresh: vi.fn(),
  account: vi.fn(),
}));
vi.mock("@/lib/bufferProvider", async (original) => ({
  ...(await original<typeof import("@/lib/bufferProvider")>()),
  exchangeBufferCode: provider.exchange,
  refreshBufferTokens: provider.refresh,
  readBufferAccount: provider.account,
}));
import {
  beginBufferConnection,
  stageBufferCallback,
  finishBufferConnection,
  getBufferConnection,
  disconnectBufferConnection,
  withBufferAccessToken,
} from "@/lib/bufferConnectionServer";
import {
  bufferDigest,
  bufferChallenge,
  decryptBufferSecret,
  encryptBufferSecret,
} from "@/lib/bufferCrypto";

const owner = "123e4567-e89b-42d3-a456-426614174000";
const connectionId = "123e4567-e89b-42d3-a456-426614174001";
const stateId = "123e4567-e89b-42d3-a456-426614174002";
const connection = () => ({
  id: connectionId,
  user_id: owner,
  revision: 2,
  status: "connected",
  account_label: "Fictional account",
  channels: [
    { id: "channel", name: "Fictional channel", service: "twitter", organizationId: "org" },
  ],
});
function store(
  tables: Record<string, unknown[]>,
  rpcResult?: (args: Record<string, unknown>) => unknown,
  tableError?: string
) {
  const rpc = vi.fn(async (_name, args) => ({
    data: rpcResult?.(args) ?? connection(),
    error: null,
  }));
  const from = vi.fn((table: string) => {
    const filters: [string, unknown][] = [];
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((key, value) => {
        filters.push([key, value]);
        return query;
      }),
      maybeSingle: vi.fn(async () => ({
        data:
          (tables[table] ?? []).find((row) =>
            filters.every(([key, value]) => (row as Record<string, unknown>)[key] === value)
          ) ?? null,
        error: table === tableError ? { code: "42P01" } : null,
      })),
    };
    return query;
  });
  return { client: { from, rpc } as unknown as SupabaseClient, rpc, from };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BUFFER_PUBLISHING_ENABLED", "true");
  vi.stubEnv("BUFFER_CLIENT_ID", "client");
  vi.stubEnv("BUFFER_CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("BUFFER_REDIRECT_URI", "https://postbeacon.app/api/buffer/callback");
  vi.stubEnv("BUFFER_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
});
afterEach(() => vi.unstubAllEnvs());
describe("Buffer OAuth owner and privacy boundary", () => {
  it("persists only hashed state/binding and encrypted PKCE before returning the provider URL", async () => {
    const sb = store({});
    const started = await beginBufferConnection(sb.client, owner);
    const url = new URL(started.authorizationUrl),
      args = sb.rpc.mock.calls[0][1];
    const data = args.p_data as Record<string, string>;
    expect(url.origin + url.pathname).toBe("https://auth.buffer.com/auth");
    expect(data.state_hash).toBe(bufferDigest(url.searchParams.get("state")!));
    expect(data.binding_hash).toBe(bufferDigest(started.binding));
    const verifier = decryptBufferSecret(
      data.verifier_ciphertext,
      owner,
      data.state_id,
      "oauth-verifier"
    );
    expect(url.searchParams.get("code_challenge")).toBe(bufferChallenge(verifier));
    expect(url.searchParams.get("scope")).not.toContain("account:write");
    expect(JSON.stringify(args)).not.toContain(verifier);
    expect(JSON.stringify(args)).not.toContain(started.binding);
    expect(provider.exchange).not.toHaveBeenCalled();
  });
  it("stages an encrypted code without exchanging it on the callback", async () => {
    const state = "a".repeat(43),
      binding = "b".repeat(43);
    const sb = store({
      buffer_oauth_states: [
        {
          id: stateId,
          user_id: owner,
          connection_id: connectionId,
          connection_revision: 2,
          state_hash: bufferDigest(state),
          binding_hash: bufferDigest(binding),
        },
      ],
    });
    await stageBufferCallback(sb.client, state, binding, "synthetic-code");
    const args = sb.rpc.mock.calls[0][1],
      data = args.p_data as Record<string, string>;
    expect(args.p_action).toBe("stage-code");
    expect(decryptBufferSecret(data.code_ciphertext, owner, stateId, "oauth-code")).toBe(
      "synthetic-code"
    );
    expect(JSON.stringify(args)).not.toContain("synthetic-code");
    expect(provider.exchange).not.toHaveBeenCalled();
  });
  it("rejects account A callback completion while account B is currently signed in", async () => {
    const binding = "b".repeat(43);
    const sb = store({
      buffer_oauth_states: [
        {
          id: stateId,
          user_id: owner,
          connection_id: connectionId,
          connection_revision: 2,
          binding_hash: bufferDigest(binding),
          status: "staged",
        },
      ],
    });
    await expect(
      finishBufferConnection(sb.client, "123e4567-e89b-42d3-a456-426614174003", binding)
    ).rejects.toMatchObject({ status: 409 });
    expect(sb.rpc).not.toHaveBeenCalled();
    expect(provider.exchange).not.toHaveBeenCalled();
  });
  it("claims the code before one exchange and stores only encrypted credential fields", async () => {
    const binding = "b".repeat(43);
    const staged = {
      id: stateId,
      user_id: owner,
      connection_id: connectionId,
      connection_revision: 2,
      binding_hash: bufferDigest(binding),
      status: "staged",
      verifier_ciphertext: encryptBufferSecret(
        "verifier",
        owner,
        stateId,
        "oauth-verifier"
      ),
      code_ciphertext: encryptBufferSecret("code", owner, stateId, "oauth-code"),
    };
    const sb = store(
      { buffer_oauth_states: [staged], buffer_connections: [connection()] },
      (args) => (args.p_action === "claim-code" ? staged : { ...connection(), revision: 3 })
    );
    provider.exchange.mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: "2026-10-28T00:00:00Z",
    });
    provider.account.mockResolvedValue({
      accountId: "buffer-account",
      accountLabel: "Fictional account",
      channels: connection().channels,
    });
    const result = await finishBufferConnection(sb.client, owner, binding);
    expect(sb.rpc.mock.calls[0][1].p_action).toBe("claim-code");
    expect(sb.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      provider.exchange.mock.invocationCallOrder[0]
    );
    expect(provider.exchange).toHaveBeenCalledExactlyOnceWith("code", "verifier");
    const stored = sb.rpc.mock.calls[1][1].p_data as Record<string, string>;
    expect(
      decryptBufferSecret(stored.access_ciphertext, owner, connectionId, "access-token")
    ).toBe("new-access");
    expect(
      decryptBufferSecret(stored.refresh_ciphertext, owner, connectionId, "refresh-token")
    ).toBe("new-refresh");
    expect(JSON.stringify(sb.rpc.mock.calls)).not.toContain("new-access");
    expect(JSON.stringify(result)).not.toMatch(
      /new-access|new-refresh|verifier_ciphertext|binding_hash/
    );
    expect(result.revision).toBe(3);
  });
  it("does not hide unreadable previously installed connections behind a disabled flag", async () => {
    vi.stubEnv("BUFFER_PUBLISHING_ENABLED", "false");
    const sb = store(
      { entitlements: [{ user_id: owner, buffer_data_initialized: true }] },
      undefined,
      "buffer_connections"
    );
    await expect(getBufferConnection(sb.client, owner)).rejects.toMatchObject({
      status: 503,
    });
    const legacy = store(
      { entitlements: [{ user_id: owner }] },
      undefined,
      "buffer_connections"
    );
    expect(await getBufferConnection(legacy.client, owner)).toBeNull();
    vi.stubEnv("BUFFER_PUBLISHING_ENABLED", "true");
    await expect(getBufferConnection(legacy.client, owner)).rejects.toMatchObject({
      status: 503,
    });
  });
  it("returns only public metadata and permits disconnect without credentials or an enabled flag", async () => {
    vi.stubEnv("BUFFER_PUBLISHING_ENABLED", "false");
    vi.stubEnv("BUFFER_TOKEN_ENCRYPTION_KEY", "");
    const sb = store(
      {
        buffer_connections: [
          {
            ...connection(),
            refresh_ciphertext: "never-return",
            buffer_account_id: "server-only-quota-input",
          },
        ],
      },
      () => ({ ...connection(), revision: 3, status: "disconnected", channels: [] })
    );
    expect(JSON.stringify(await getBufferConnection(sb.client, owner))).not.toMatch(
      /never-return|server-only-quota-input/
    );
    expect((await disconnectBufferConnection(sb.client, owner))?.status).toBe(
      "disconnected"
    );
    expect(sb.rpc.mock.calls[0][1].p_action).toBe("disconnect");
    expect(provider.refresh).not.toHaveBeenCalled();
  });
});
describe("revocation recovery", () => {
  it("can still revoke when old channel metadata is unreadable", async () => {
    vi.stubEnv("BUFFER_PUBLISHING_ENABLED", "false");
    vi.stubEnv("BUFFER_TOKEN_ENCRYPTION_KEY", "");
    const sb = store(
      { buffer_connections: [{ ...connection(), channels: "corrupt historical value" }] },
      () => ({ ...connection(), revision: 3, status: "disconnected", channels: [] })
    );
    expect((await disconnectBufferConnection(sb.client, owner))?.status).toBe(
      "disconnected"
    );
    expect(sb.rpc.mock.calls[0][1].p_action).toBe("disconnect");
  });
});
describe("server-only token consumption", () => {
  const vault = () => ({
    user_id: owner,
    connection_id: connectionId,
    access_ciphertext: encryptBufferSecret("access", owner, connectionId, "access-token"),
    refresh_ciphertext: encryptBufferSecret(
      "refresh",
      owner,
      connectionId,
      "refresh-token"
    ),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    lease_token: null,
    lease_until: null,
  });
  it("checks owner and revision immediately before invoking a server callback", async () => {
    const sb = store({
      buffer_connections: [connection()],
      buffer_connection_secrets: [vault()],
    });
    const operation = vi.fn(async (token) =>
      token === "access" ? "receipt-only" : "wrong"
    );
    expect(await withBufferAccessToken(sb.client, owner, connectionId, 2, operation)).toBe(
      "receipt-only"
    );
    expect(sb.rpc.mock.calls[0][1]).toMatchObject({
      p_action: "check",
      p_user_id: owner,
      p_revision: 2,
    });
    await expect(
      withBufferAccessToken(sb.client, owner, connectionId, 1, operation)
    ).rejects.toMatchObject({ status: 409 });
    expect(operation).toHaveBeenCalledOnce();
  });
  it("never retries an ambiguous refresh or invokes the provider operation afterwards", async () => {
    const value = { ...vault(), expires_at: new Date(Date.now() - 1).toISOString() };
    const lease = "123e4567-e89b-42d3-a456-426614174004";
    const sb = store(
      { buffer_connections: [connection()], buffer_connection_secrets: [value] },
      (args) =>
        args.p_action === "claim-refresh" ? { ...value, lease_token: lease } : connection()
    );
    provider.refresh.mockRejectedValue(new Error("private refresh token=secret"));
    const operation = vi.fn();
    await expect(
      withBufferAccessToken(sb.client, owner, connectionId, 2, operation)
    ).rejects.not.toThrow("private refresh");
    expect(provider.refresh).toHaveBeenCalledOnce();
    expect(operation).not.toHaveBeenCalled();
    expect(sb.rpc.mock.calls.at(-1)?.[1]).toMatchObject({
      p_action: "reauth",
      p_revision: 2,
      p_data: { lease_token: lease },
    });
  });
  it("does not reuse a refresh token while another process owns the lease", async () => {
    const sb = store({
      buffer_connections: [connection()],
      buffer_connection_secrets: [
        {
          ...vault(),
          lease_token: "another-worker",
          lease_until: new Date(Date.now() + 30000).toISOString(),
        },
      ],
    });
    await expect(
      withBufferAccessToken(sb.client, owner, connectionId, 2, vi.fn())
    ).rejects.toMatchObject({ status: 409 });
    expect(provider.refresh).not.toHaveBeenCalled();
    expect(sb.rpc).not.toHaveBeenCalled();
  });
});
