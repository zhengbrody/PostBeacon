import { describe, expect, it } from "vitest";
import {
  guestPreviewQuotaIdentity,
  resolveGuestPreviewIdentity,
  signGuestPreviewIdentity,
  verifyGuestPreviewIdentity,
} from "@/lib/guestPreviewToken";

const SECRET = "a-secure-test-secret-with-at-least-32-bytes";
const NOW = Date.UTC(2026, 6, 21);

describe("guest preview signed identity", () => {
  it("round-trips a signed random identity and reuses it", () => {
    const first = resolveGuestPreviewIdentity(undefined, SECRET, NOW, 86_400);
    expect(first.created).toBe(true);
    expect(first.token).not.toContain("http");

    const second = resolveGuestPreviewIdentity(first.token, SECRET, NOW + 1_000, 86_400);
    expect(second).toEqual({ id: first.id, token: first.token, created: false });
  });

  it("rejects tampering, future issuance and expiry", () => {
    const issued = Math.floor(NOW / 1000);
    const id = "abcdefghijklmnopqrstuvwx";
    const token = signGuestPreviewIdentity(id, issued, SECRET);
    expect(verifyGuestPreviewIdentity(token, SECRET, NOW, 3600)?.id).toBe(id);
    expect(verifyGuestPreviewIdentity(`${token}x`, SECRET, NOW, 3600)).toBeNull();
    expect(
      verifyGuestPreviewIdentity(
        token,
        "different-secret-with-at-least-32-bytes",
        NOW,
        3600
      )
    ).toBeNull();
    expect(verifyGuestPreviewIdentity(token, SECRET, NOW + 3_601_000, 3600)).toBeNull();

    const future = signGuestPreviewIdentity(id, issued + 120, SECRET);
    expect(verifyGuestPreviewIdentity(future, SECRET, NOW, 3600)).toBeNull();
  });

  it("derives a stable opaque quota key, not the cookie id", () => {
    const id = "abcdefghijklmnopqrstuvwx";
    const key = guestPreviewQuotaIdentity(id, SECRET);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain(id);
    expect(guestPreviewQuotaIdentity(id, SECRET)).toBe(key);
  });
});
