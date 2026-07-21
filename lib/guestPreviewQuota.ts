import { fetchWithTimeout } from "./fetch";
import { PublicError } from "./errors";

export interface GuestPreviewQuotaRequest {
  visitorKey: string;
  nowMs: number;
  windowSeconds: number;
  perVisitorLimit: number;
  globalLimit: number;
}

export interface GuestPreviewQuotaDecision {
  allowed: boolean;
  reason?: "visitor" | "global";
  retryAfterSeconds: number;
}

export interface GuestPreviewQuotaStore {
  consume(request: GuestPreviewQuotaRequest): Promise<GuestPreviewQuotaDecision>;
}

export interface GuestPreviewQuotaConnection {
  endpoint: string;
  token: string;
}

/** One parser shared by public capability checks and the runtime store. A
 * malformed, cleartext or credential-bearing endpoint is treated exactly like
 * missing configuration so the feature always fails closed. */
export function parseGuestPreviewQuotaConnection(
  endpoint = process.env.UPSTASH_REDIS_REST_URL,
  token = process.env.UPSTASH_REDIS_REST_TOKEN
): GuestPreviewQuotaConnection | null {
  if (!endpoint || !token?.trim()) return null;
  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return { endpoint: url.toString().replace(/\/$/, ""), token };
  } catch {
    return null;
  }
}

export function guestPreviewQuotaConfigured(): boolean {
  return parseGuestPreviewQuotaConnection() !== null;
}

export class GuestPreviewLimitError extends PublicError {
  constructor(readonly retryAfterSeconds: number) {
    super("Guest preview limit reached. Try again after the current window.", 429);
    this.name = "GuestPreviewLimitError";
  }
}

const LUA = `
local visitor = redis.call('INCR', KEYS[1])
if visitor == 1 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
if visitor > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return {0, 'visitor'}
end
local global = redis.call('INCR', KEYS[2])
if global == 1 then redis.call('EXPIRE', KEYS[2], ARGV[3]) end
if global > tonumber(ARGV[2]) then
  redis.call('DECR', KEYS[2])
  redis.call('DECR', KEYS[1])
  return {0, 'global'}
end
return {1, 'ok'}
`;

function retryAfter(nowMs: number, windowSeconds: number): number {
  const nowSeconds = Math.floor(nowMs / 1000);
  return Math.max(1, windowSeconds - (nowSeconds % windowSeconds));
}

/** Atomic, shared quota store for serverless production. Keys contain only a
 * keyed digest of the random visitor cookie and an epoch window number. */
export class UpstashGuestPreviewQuotaStore implements GuestPreviewQuotaStore {
  private readonly endpoint: string;
  private readonly token: string;

  constructor(endpoint: string, token: string) {
    const connection = parseGuestPreviewQuotaConnection(endpoint, token);
    if (!connection) {
      throw new Error("Guest preview quota endpoint must be credential-free HTTPS.");
    }
    this.endpoint = connection.endpoint;
    this.token = connection.token;
  }

  async consume(request: GuestPreviewQuotaRequest): Promise<GuestPreviewQuotaDecision> {
    const bucket = Math.floor(request.nowMs / 1000 / request.windowSeconds);
    const prefix = "postbeacon:guest-preview";
    const visitor = `${prefix}:visitor:${request.visitorKey}:${bucket}`;
    const global = `${prefix}:global:${bucket}`;
    const ttl = request.windowSeconds + 60;
    const response = await fetchWithTimeout(
      this.endpoint.replace(/\/$/, ""),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          "EVAL",
          LUA,
          "2",
          visitor,
          global,
          String(request.perVisitorLimit),
          String(request.globalLimit),
          String(ttl),
        ]),
      },
      3000
    );
    if (!response.ok) throw new Error("Persistent guest preview quota is unavailable.");
    const body = (await response.json()) as { result?: unknown };
    const result = Array.isArray(body.result) ? body.result : null;
    if (!result || (Number(result[0]) !== 0 && Number(result[0]) !== 1)) {
      throw new Error("Persistent guest preview quota returned an invalid result.");
    }
    return {
      allowed: Number(result[0]) === 1,
      ...(Number(result[0]) === 0
        ? { reason: result[1] === "global" ? ("global" as const) : ("visitor" as const) }
        : {}),
      retryAfterSeconds: retryAfter(request.nowMs, request.windowSeconds),
    };
  }
}

/** Test-only/local seam. The production factory below never selects this: an
 * in-memory map cannot enforce a global budget across serverless instances. */
export class MemoryGuestPreviewQuotaStore implements GuestPreviewQuotaStore {
  private readonly counts = new Map<string, number>();

  async consume(request: GuestPreviewQuotaRequest): Promise<GuestPreviewQuotaDecision> {
    const bucket = Math.floor(request.nowMs / 1000 / request.windowSeconds);
    const visitorKey = `v:${request.visitorKey}:${bucket}`;
    const globalKey = `g:${bucket}`;
    const visitor = this.counts.get(visitorKey) ?? 0;
    const global = this.counts.get(globalKey) ?? 0;
    const retryAfterSeconds = retryAfter(request.nowMs, request.windowSeconds);
    if (visitor >= request.perVisitorLimit) {
      return { allowed: false, reason: "visitor", retryAfterSeconds };
    }
    if (global >= request.globalLimit) {
      return { allowed: false, reason: "global", retryAfterSeconds };
    }
    this.counts.set(visitorKey, visitor + 1);
    this.counts.set(globalKey, global + 1);
    return { allowed: true, retryAfterSeconds };
  }
}

/** No persistent store means no preview. This is intentionally fail-closed. */
export function configuredGuestPreviewQuotaStore(): GuestPreviewQuotaStore | null {
  const connection = parseGuestPreviewQuotaConnection();
  return connection
    ? new UpstashGuestPreviewQuotaStore(connection.endpoint, connection.token)
    : null;
}

export async function reserveGuestPreviewQuota(
  store: GuestPreviewQuotaStore,
  request: GuestPreviewQuotaRequest
): Promise<void> {
  let decision: GuestPreviewQuotaDecision;
  try {
    decision = await store.consume(request);
  } catch {
    throw new PublicError("Guest preview is temporarily unavailable.", 503);
  }
  if (!decision.allowed) throw new GuestPreviewLimitError(decision.retryAfterSeconds);
}
