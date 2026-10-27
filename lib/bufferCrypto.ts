import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { PublicError } from "./errors";

function key() {
  const raw = process.env.BUFFER_TOKEN_ENCRYPTION_KEY ?? "";
  const value = Buffer.from(raw, "base64");
  if (value.length !== 32 || value.toString("base64") !== raw)
    throw new PublicError("Buffer credential protection is unavailable.", 503);
  return value;
}
const aad = (owner: string, record: string, purpose: string) =>
  Buffer.from(JSON.stringify(["postbeacon-buffer-v1", owner, record, purpose]));
export const bufferRandom = () => randomBytes(32).toString("base64url");
export const bufferDigest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const bufferChallenge = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
export const bufferAccountQuotaKey = (accountId: string) =>
  createHmac("sha256", key())
    .update("buffer-account-quota-v1\0")
    .update(accountId)
    .digest("hex");
export function encryptBufferSecret(
  value: string,
  owner: string,
  record: string,
  purpose: string
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(aad(owner, record, purpose));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function decryptBufferSecret(
  value: string,
  owner: string,
  record: string,
  purpose: string
): string {
  try {
    const parts = value.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Invalid ciphertext");
    const iv = Buffer.from(parts[1], "base64url"),
      tag = Buffer.from(parts[2], "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAAD(aad(owner, record, purpose));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new PublicError(
      "Buffer credentials could not be read safely. Reconnect the account.",
      503
    );
  }
}
