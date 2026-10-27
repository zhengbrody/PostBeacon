import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { asRecord, asString } from "./coerce";
import { PublicError } from "./errors";
import {
  bufferConnectionSchema,
  type BufferConnection,
  type BufferConnectionList,
} from "./bufferConnections";
import {
  BUFFER_SCOPES,
  bufferPublishingEnabled,
  bufferSetupIssues,
  requireBufferConfig,
} from "./bufferConfig";
import {
  bufferChallenge,
  bufferDigest,
  bufferRandom,
  decryptBufferSecret,
  encryptBufferSecret,
} from "./bufferCrypto";
import {
  BufferReauthorizationError,
  exchangeBufferCode,
  readBufferAccount,
  refreshBufferTokens,
  type BufferTokens,
} from "./bufferProvider";

export const BUFFER_BINDING_COOKIE = "__Host-postbeacon-buffer";
const publicColumns = "id,revision,status,account_label,channels";
const missingTable = (code: string | undefined) =>
  ["42P01", "PGRST205"].includes(code ?? "");
const storeError = () =>
  new PublicError(
    "Buffer connection storage is unavailable. Verify the installation before continuing.",
    503
  );

function publicConnection(raw: unknown): BufferConnection {
  const row = asRecord(raw);
  const parsed = bufferConnectionSchema.safeParse({
    id: row.id,
    revision: row.revision,
    status: row.status,
    accountLabel: row.account_label,
    channels: row.channels,
  });
  if (!parsed.success) throw storeError();
  return parsed.data;
}
export async function getBufferConnection(
  sb: SupabaseClient,
  userId: string
): Promise<BufferConnection | null> {
  const { data, error } = await sb
    .from("buffer_connections")
    .select(publicColumns)
    .eq("user_id", userId)
    .maybeSingle();
  if (error && missingTable(error.code)) {
    const marker = await sb
      .from("entitlements")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (
      marker.error ||
      asRecord(marker.data).buffer_data_initialized === true ||
      bufferPublishingEnabled()
    )
      throw storeError();
    return null;
  }
  if (error) throw storeError();
  return data ? publicConnection(data) : null;
}
export async function bufferConnectionList(
  sb: SupabaseClient,
  userId: string
): Promise<BufferConnectionList> {
  return {
    enabled: bufferPublishingEnabled(),
    connection: await getBufferConnection(sb, userId),
    setupIssues: bufferSetupIssues(),
  };
}
async function transition(
  sb: SupabaseClient,
  userId: string,
  action: string,
  connectionId: string | null,
  revision: number | null,
  data: Record<string, unknown> = {}
) {
  const result = await sb.rpc("buffer_connection_transition", {
    p_user_id: userId,
    p_action: action,
    p_connection_id: connectionId,
    p_revision: revision,
    p_data: data,
  });
  if (result.error) {
    if (result.error.message?.includes("buffer_rate_limited"))
      throw new PublicError(
        "Wait 30 seconds before starting another Buffer connection or channel refresh. Failed reads also use this allowance.",
        429
      );
    throw storeError();
  }
  if (!result.data)
    throw new PublicError(
      "The Buffer connection changed or this authorization expired. Reload and reconnect if needed.",
      409
    );
  return asRecord(result.data);
}
export async function beginBufferConnection(sb: SupabaseClient, userId: string) {
  const config = requireBufferConfig();
  const state = bufferRandom(),
    binding = bufferRandom(),
    verifier = bufferRandom(),
    stateId = randomUUID();
  await transition(sb, userId, "begin", randomUUID(), null, {
    state_id: stateId,
    state_hash: bufferDigest(state),
    binding_hash: bufferDigest(binding),
    verifier_ciphertext: encryptBufferSecret(verifier, userId, stateId, "oauth-verifier"),
  });
  const url = new URL("https://auth.buffer.com/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: BUFFER_SCOPES.join(" "),
    state,
    code_challenge: bufferChallenge(verifier),
    code_challenge_method: "S256",
    prompt: "consent",
  }).toString();
  return { authorizationUrl: url.toString(), binding };
}
export async function stageBufferCallback(
  sb: SupabaseClient,
  state: string,
  binding: string,
  code: string
) {
  requireBufferConfig();
  if (
    !/^[\w-]{43}$/.test(state) ||
    !/^[\w-]{43}$/.test(binding) ||
    !code ||
    code.length > 32768
  )
    throw new PublicError("Buffer authorization could not be verified.", 403);
  const { data, error } = await sb
    .from("buffer_oauth_states")
    .select("id,user_id,connection_id,connection_revision")
    .eq("state_hash", bufferDigest(state))
    .eq("binding_hash", bufferDigest(binding))
    .maybeSingle();
  if (error) throw storeError();
  const row = asRecord(data);
  if (!data) throw new PublicError("Buffer authorization could not be verified.", 403);
  await transition(
    sb,
    asString(row.user_id),
    "stage-code",
    asString(row.connection_id),
    Number(row.connection_revision),
    {
      state_id: row.id,
      state_hash: bufferDigest(state),
      binding_hash: bufferDigest(binding),
      code_ciphertext: encryptBufferSecret(
        code,
        asString(row.user_id),
        asString(row.id),
        "oauth-code"
      ),
    }
  );
}
const encryptedTokens = (tokens: BufferTokens, userId: string, connectionId: string) => ({
  access_ciphertext: encryptBufferSecret(
    tokens.accessToken,
    userId,
    connectionId,
    "access-token"
  ),
  refresh_ciphertext: encryptBufferSecret(
    tokens.refreshToken,
    userId,
    connectionId,
    "refresh-token"
  ),
  expires_at: tokens.expiresAt,
});
async function requireReauthorization(
  sb: SupabaseClient,
  userId: string,
  connection: BufferConnection,
  leaseToken?: string
) {
  await transition(
    sb,
    userId,
    "reauth",
    connection.id,
    connection.revision,
    leaseToken ? { lease_token: leaseToken } : {}
  ).catch(() => undefined);
}
export async function finishBufferConnection(
  sb: SupabaseClient,
  userId: string,
  binding: string
) {
  requireBufferConfig();
  if (!/^[\w-]{43}$/.test(binding))
    throw new PublicError("Start a new Buffer authorization from this browser.", 409);
  const { data, error } = await sb
    .from("buffer_oauth_states")
    .select("id,connection_id,connection_revision")
    .eq("user_id", userId)
    .eq("binding_hash", bufferDigest(binding))
    .eq("status", "staged")
    .maybeSingle();
  if (error) throw storeError();
  if (!data)
    throw new PublicError(
      "No matching Buffer authorization belongs to this signed-in account. Start again from the current account.",
      409
    );
  const row = asRecord(data),
    connection = await getBufferConnection(sb, userId);
  if (
    !connection ||
    connection.id !== row.connection_id ||
    connection.revision !== row.connection_revision
  )
    throw new PublicError(
      "Buffer authorization is stale. Reconnect from the current account.",
      409
    );
  const staged = await transition(
    sb,
    userId,
    "claim-code",
    connection.id,
    connection.revision,
    { state_id: row.id, binding_hash: bufferDigest(binding) }
  );
  try {
    const code = decryptBufferSecret(
      asString(staged.code_ciphertext),
      userId,
      asString(row.id),
      "oauth-code"
    );
    const verifier = decryptBufferSecret(
      asString(staged.verifier_ciphertext),
      userId,
      asString(row.id),
      "oauth-verifier"
    );
    const tokens = await exchangeBufferCode(code, verifier);
    const metadata = await readBufferAccount(tokens.accessToken, async () => {
      await transition(sb, userId, "check-code", connection.id, connection.revision, {
        state_id: row.id,
        binding_hash: bufferDigest(binding),
      });
    });
    return publicConnection(
      await transition(sb, userId, "complete-code", connection.id, connection.revision, {
        state_id: row.id,
        binding_hash: bufferDigest(binding),
        ...encryptedTokens(tokens, userId, connection.id),
        account_id: metadata.accountId,
        account_label: metadata.accountLabel,
        channels: metadata.channels,
      })
    );
  } catch (error) {
    await requireReauthorization(sb, userId, connection);
    if (error instanceof PublicError) throw error;
    throw new BufferReauthorizationError();
  }
}

/** Tokens never leave this server callback. SQL CAS/lease serialization covers
 * concurrent processes and rotating refresh tokens; ambiguous refreshes require reauth. */
export async function withBufferAccessToken<T>(
  sb: SupabaseClient,
  userId: string,
  connectionId: string,
  revision: number,
  callback: (accessToken: string, connection: BufferConnection) => Promise<T>
): Promise<T> {
  requireBufferConfig();
  const connection = await getBufferConnection(sb, userId);
  if (
    !connection ||
    connection.id !== connectionId ||
    connection.revision !== revision ||
    connection.status !== "connected"
  )
    throw new PublicError("Review the current Buffer connection before continuing.", 409);
  const readVault = async () => {
    const result = await sb
      .from("buffer_connection_secrets")
      .select("access_ciphertext,refresh_ciphertext,expires_at,lease_token,lease_until")
      .eq("user_id", userId)
      .eq("connection_id", connectionId)
      .maybeSingle();
    if (result.error || !result.data) throw storeError();
    return asRecord(result.data);
  };
  let vault = await readVault();
  if (vault.lease_token || !Number.isFinite(Date.parse(asString(vault.expires_at)))) {
    if (
      !Number.isFinite(Date.parse(asString(vault.expires_at))) ||
      Date.parse(asString(vault.lease_until)) <= Date.now()
    ) {
      await requireReauthorization(
        sb,
        userId,
        connection,
        asString(vault.lease_token) || undefined
      );
      throw new BufferReauthorizationError();
    }
    throw new PublicError(
      "Buffer credential refresh is already in progress. Wait for its receipt; do not retry a refresh manually.",
      409
    );
  }
  if (Date.parse(asString(vault.expires_at)) <= Date.now() + 60000) {
    const claimed = await transition(sb, userId, "claim-refresh", connectionId, revision);
    if (claimed.busy === true) {
      if (claimed.expired === true) {
        await requireReauthorization(sb, userId, connection, asString(claimed.lease_token));
        throw new BufferReauthorizationError();
      }
      throw new PublicError("Buffer credential refresh is already in progress.", 409);
    }
    if (claimed.fresh !== true) {
      const lease = asString(claimed.lease_token);
      try {
        const tokens = await refreshBufferTokens(
          decryptBufferSecret(
            asString(claimed.refresh_ciphertext),
            userId,
            connectionId,
            "refresh-token"
          )
        );
        await transition(sb, userId, "complete-refresh", connectionId, revision, {
          lease_token: lease,
          ...encryptedTokens(tokens, userId, connectionId),
        });
      } catch (error) {
        await requireReauthorization(sb, userId, connection, lease);
        if (error instanceof PublicError) throw error;
        throw new BufferReauthorizationError();
      }
    }
    vault = await readVault();
    if (vault.lease_token)
      throw new PublicError("Buffer credential refresh has not completed.", 409);
  }
  await transition(sb, userId, "check", connectionId, revision);
  try {
    return await callback(
      decryptBufferSecret(
        asString(vault.access_ciphertext),
        userId,
        connectionId,
        "access-token"
      ),
      connection
    );
  } catch (error) {
    if (error instanceof BufferReauthorizationError)
      await requireReauthorization(sb, userId, connection);
    throw error;
  }
}
export async function refreshBufferChannels(sb: SupabaseClient, userId: string) {
  requireBufferConfig();
  const connection = await getBufferConnection(sb, userId);
  if (!connection) throw new PublicError("Connect a Buffer account first.", 409);
  await transition(sb, userId, "claim-channels", connection.id, connection.revision);
  const metadata = await withBufferAccessToken(
    sb,
    userId,
    connection.id,
    connection.revision,
    (token) =>
      readBufferAccount(token, async () => {
        await transition(sb, userId, "check", connection.id, connection.revision);
      })
  );
  return publicConnection(
    await transition(sb, userId, "channels", connection.id, connection.revision, {
      account_id: metadata.accountId,
      account_label: metadata.accountLabel,
      channels: metadata.channels,
    })
  );
}
export async function disconnectBufferConnection(sb: SupabaseClient, userId: string) {
  // Revocation must not depend on decrypting a token or interpreting possibly
  // stale/corrupt channel metadata. UUID identity is enforced by the database.
  const { data, error } = await sb
    .from("buffer_connections")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error && missingTable(error.code)) {
    await getBufferConnection(sb, userId);
    return null;
  }
  if (error) throw storeError();
  if (!data) return null;
  return publicConnection(
    await transition(sb, userId, "disconnect", asString(asRecord(data).id), null)
  );
}
