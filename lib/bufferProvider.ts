import { z } from "zod";
import { PublicError } from "./errors";
import { asRecord } from "./coerce";
import { mapLimit } from "./async";
import { BUFFER_SCOPES, requireBufferConfig } from "./bufferConfig";
import { bufferChannelSchema, type BufferChannel } from "./bufferConnections";

export class BufferReauthorizationError extends PublicError {
  constructor() {
    super(
      "Buffer authorization is unavailable. Reconnect the account before continuing.",
      409
    );
  }
}

/** Fixed provider endpoints only. No redirect, retry, upstream error text or token logging. */
async function providerJson(
  url: "https://auth.buffer.com/token" | "https://api.buffer.com",
  init: RequestInit
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403)
      throw new BufferReauthorizationError();
    if (!response.ok || !response.body)
      throw new PublicError(
        "Buffer did not return a usable response. Check the connection before retrying.",
        502
      );
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > 131072)
          throw new PublicError("Buffer response exceeded the supported limit.", 502);
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return asRecord(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw new PublicError(
      "Buffer request could not be confirmed. Do not repeat an ambiguous credential exchange; reconnect instead.",
      502
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function bufferGraphql(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {}
) {
  requireBufferConfig();
  const body = await providerJson("https://api.buffer.com", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (Array.isArray(body.errors) && body.errors.length)
    throw new PublicError(
      "Buffer could not complete the requested operation. Review its receipt before retrying.",
      502
    );
  if (!body.data || typeof body.data !== "object")
    throw new PublicError("Buffer response was incomplete.", 502);
  return asRecord(body.data);
}

const tokensSchema = z.object({
  access_token: z.string().min(1).max(32768),
  refresh_token: z.string().min(1).max(32768),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().min(1).max(86400),
  scope: z.string().max(2000).optional(),
});
export interface BufferTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}
async function tokenRequest(
  fields: Record<string, string>,
  inheritedScopes = false
): Promise<BufferTokens> {
  const config = requireBufferConfig();
  const result = tokensSchema.safeParse(
    await providerJson("https://auth.buffer.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...fields,
      }),
    })
  );
  if (
    !result.success ||
    (result.data.scope === undefined && !inheritedScopes) ||
    (result.data.scope !== undefined &&
      BUFFER_SCOPES.some((scope) => !result.data.scope!.split(/\s+/).includes(scope)))
  )
    throw new BufferReauthorizationError();
  return {
    accessToken: result.data.access_token,
    refreshToken: result.data.refresh_token,
    expiresAt: new Date(Date.now() + result.data.expires_in * 1000).toISOString(),
  };
}
export const exchangeBufferCode = (code: string, verifier: string) =>
  tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: requireBufferConfig().redirectUri,
  });
export const refreshBufferTokens = (refreshToken: string) =>
  // RFC 6749 §6 permits omission when unchanged. Initial authorization already
  // validated every required scope; an explicitly reduced scope is rejected.
  tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, true);

const id = z.string().min(1).max(200);
const accountSchema = z.object({
  id,
  organizations: z.array(z.object({ id, name: z.string().min(1).max(200) })).max(4),
});
const channelListSchema = z
  .array(
    z.object({
      id,
      name: z.string().min(1).max(200),
      service: z.string().max(80),
      isDisconnected: z.boolean(),
      isLocked: z.boolean(),
    })
  )
  .max(100);
export async function readBufferAccount(
  accessToken: string,
  beforeRead?: () => Promise<void>
): Promise<{ accountId: string; accountLabel: string; channels: BufferChannel[] }> {
  await beforeRead?.();
  const account = accountSchema.safeParse(
    (await bufferGraphql(accessToken, "query { account { id organizations { id name } } }"))
      .account
  );
  if (!account.success)
    throw new PublicError(
      "This Buffer account exceeds the supported pilot or returned incomplete metadata.",
      502
    );
  const channels: BufferChannel[] = [];
  const seen = new Set<string>();
  const organizations = await mapLimit(
    account.data.organizations,
    2,
    async (organization) => {
      await beforeRead?.();
      const data = await bufferGraphql(
        accessToken,
        "query PostBeaconChannels($organizationId: OrganizationId!) { channels(input: { organizationId: $organizationId }) { id name service isDisconnected isLocked } }",
        { organizationId: organization.id }
      );
      const list = channelListSchema.safeParse(data.channels);
      if (!list.success)
        throw new PublicError(
          "Buffer channels could not be read completely within the pilot limit.",
          502
        );
      return { organizationId: organization.id, channels: list.data };
    }
  );
  for (const organization of organizations) {
    for (const channel of organization.channels) {
      if (
        channel.isDisconnected ||
        channel.isLocked ||
        !["twitter", "linkedin"].includes(channel.service)
      )
        continue;
      const supported = bufferChannelSchema.parse({
        ...channel,
        organizationId: organization.organizationId,
      });
      if (seen.has(supported.id))
        throw new PublicError("Buffer channel identities were inconsistent.", 502);
      seen.add(supported.id);
      channels.push(supported);
      if (channels.length > 100)
        throw new PublicError(
          "This account exceeds the Buffer publishing pilot limit.",
          502
        );
    }
  }
  return {
    accountId: account.data.id,
    accountLabel: account.data.organizations[0]?.name ?? "Buffer account",
    channels,
  };
}
