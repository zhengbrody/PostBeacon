import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";
const ID_BYTES = 18;

export interface GuestPreviewIdentity {
  id: string;
  token: string;
  created: boolean;
}

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function equalSignature(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left, "base64url");
    const b = Buffer.from(right, "base64url");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function signGuestPreviewIdentity(
  id: string,
  issuedAtSeconds: number,
  secret: string
): string {
  const payload = `${TOKEN_VERSION}.${issuedAtSeconds}.${id}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyGuestPreviewIdentity(
  token: string | undefined,
  secret: string,
  nowMs: number,
  maxAgeSeconds: number
): { id: string; issuedAtSeconds: number } | null {
  if (!token || token.length > 512) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return null;
  const [version, issuedRaw, id, supplied] = parts;
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(id)) return null;
  if (!/^\d{1,12}$/.test(issuedRaw)) return null;
  const issuedAtSeconds = Number(issuedRaw);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    !Number.isSafeInteger(issuedAtSeconds) ||
    issuedAtSeconds > nowSeconds + 60 ||
    nowSeconds - issuedAtSeconds > maxAgeSeconds
  ) {
    return null;
  }
  const payload = `${version}.${issuedRaw}.${id}`;
  if (!equalSignature(supplied, signature(payload, secret))) return null;
  return { id, issuedAtSeconds };
}

/** Resolve a stable random visitor id without using IP addresses, user agents,
 * device fingerprints, submitted URLs, or product content. */
export function resolveGuestPreviewIdentity(
  token: string | undefined,
  secret: string,
  nowMs: number,
  maxAgeSeconds: number
): GuestPreviewIdentity {
  const verified = verifyGuestPreviewIdentity(token, secret, nowMs, maxAgeSeconds);
  if (verified) return { id: verified.id, token: token!, created: false };
  const id = randomBytes(ID_BYTES).toString("base64url");
  return {
    id,
    token: signGuestPreviewIdentity(id, Math.floor(nowMs / 1000), secret),
    created: true,
  };
}

/** Redis receives only this keyed digest of the random cookie id. */
export function guestPreviewQuotaIdentity(id: string, secret: string): string {
  return createHmac("sha256", secret).update(`quota:${id}`).digest("hex");
}
