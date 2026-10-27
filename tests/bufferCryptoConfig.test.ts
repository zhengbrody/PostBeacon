import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bufferPublishingEnabled,
  bufferSetupIssues,
  requireBufferConfig,
} from "@/lib/bufferConfig";
import {
  encryptBufferSecret,
  decryptBufferSecret,
  bufferAccountQuotaKey,
  bufferRandom,
  bufferDigest,
  bufferChallenge,
} from "@/lib/bufferCrypto";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("BUFFER_PUBLISHING_ENABLED", "true");
  vi.stubEnv("BUFFER_CLIENT_ID", "fictional-client");
  vi.stubEnv("BUFFER_CLIENT_SECRET", "fictional-client-secret");
  vi.stubEnv("BUFFER_REDIRECT_URI", "https://postbeacon.app/api/buffer/callback");
  vi.stubEnv("BUFFER_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
});
afterEach(() => vi.unstubAllEnvs());
describe("Buffer deployment configuration", () => {
  it("requires an exact feature flag and complete bounded server configuration", () => {
    expect(bufferPublishingEnabled()).toBe(true);
    for (const value of ["", "TRUE", "1", "false"]) {
      vi.stubEnv("BUFFER_PUBLISHING_ENABLED", value);
      expect(bufferPublishingEnabled()).toBe(false);
      expect(() => requireBufferConfig()).toThrow();
    }
  });
  it.each([
    "http://postbeacon.app/api/buffer/callback",
    "https://www.postbeacon.app/api/buffer/callback",
    "https://postbeacon.app/api/buffer/callback/",
    "https://postbeacon.app/api/buffer/callback?next=evil",
    "https://evil.example/api/buffer/callback",
    "http://localhost:3000/api/buffer/callback",
  ])("rejects unregistered production callback %s", (value) => {
    vi.stubEnv("BUFFER_REDIRECT_URI", value);
    expect(bufferPublishingEnabled()).toBe(false);
  });
  it("permits an explicit HTTPS localhost callback only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BUFFER_REDIRECT_URI", "https://localhost:3000/api/buffer/callback");
    expect(bufferPublishingEnabled()).toBe(true);
    vi.stubEnv("BUFFER_REDIRECT_URI", "http://localhost:3000/api/buffer/callback");
    expect(bufferPublishingEnabled()).toBe(false);
  });
  it.each([
    "",
    Buffer.alloc(31).toString("base64"),
    Buffer.alloc(32).toString("base64") + "\n",
    "invalid-key",
  ])("rejects invalid encryption keys without exposing their values", (value) => {
    vi.stubEnv("BUFFER_TOKEN_ENCRYPTION_KEY", value);
    expect(bufferPublishingEnabled()).toBe(false);
    expect(bufferSetupIssues().join(" ")).not.toContain("invalid-key");
  });
});
describe("Buffer credential confidentiality", () => {
  it("uses unique nonces and authenticates owner, record and purpose", () => {
    const first = encryptBufferSecret(
      "fictional-token",
      "owner-a",
      "connection-a",
      "access-token"
    );
    const second = encryptBufferSecret(
      "fictional-token",
      "owner-a",
      "connection-a",
      "access-token"
    );
    expect(first).not.toBe(second);
    expect(first).not.toContain("fictional-token");
    expect(decryptBufferSecret(first, "owner-a", "connection-a", "access-token")).toBe(
      "fictional-token"
    );
    for (const [owner, record, purpose] of [
      ["owner-b", "connection-a", "access-token"],
      ["owner-a", "connection-b", "access-token"],
      ["owner-a", "connection-a", "refresh-token"],
    ])
      expect(() => decryptBufferSecret(first, owner, record, purpose)).toThrow(
        /could not be read safely/
      );
    const parts = first.split("."),
      tag = Buffer.from(parts[2], "base64url");
    tag[0] ^= 1;
    parts[2] = tag.toString("base64url");
    expect(() =>
      decryptBufferSecret(parts.join("."), "owner-a", "connection-a", "access-token")
    ).toThrow();
  });
  it("uses a keyed, purpose-separated shared-account quota identity", () => {
    const value = bufferAccountQuotaKey("fictional-account");
    expect(value).toMatch(/^[a-f0-9]{64}$/);
    expect(value).toBe(bufferAccountQuotaKey("fictional-account"));
    expect(value).not.toBe(bufferDigest("fictional-account"));
    expect(value).not.toBe(bufferAccountQuotaKey("different-account"));
    vi.stubEnv("BUFFER_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64"));
    expect(value).not.toBe(bufferAccountQuotaKey("fictional-account"));
  });
  it("creates independent 256-bit state, binding and PKCE values", () => {
    const values = [bufferRandom(), bufferRandom(), bufferRandom()];
    expect(new Set(values).size).toBe(3);
    for (const value of values) expect(value).toMatch(/^[\w-]{43}$/);
    expect(bufferChallenge(values[0])).toMatch(/^[\w-]{43}$/);
  });
});
