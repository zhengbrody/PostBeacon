import type { GuestPreviewResult } from "./types";

const KEY = "postbeacon:guest-preview-handoff";
export const PREVIEW_HANDOFF_TTL_MS = 60 * 60 * 1000;
export const PREVIEW_AUTH_TTL_MS = 30 * 60 * 1000;

export interface PreviewHandoff {
  version: 2;
  url: string;
  preview: GuestPreviewResult;
  createdAt: string;
  expiresAt: string;
  authNonce?: string;
  authExpiresAt?: string;
}

function isPreview(value: unknown): value is GuestPreviewResult {
  if (!value || typeof value !== "object") return false;
  const preview = value as Partial<GuestPreviewResult>;
  return Boolean(
    preview.source?.url &&
    preview.source?.hostname &&
    preview.product?.name &&
    preview.channel?.platformId &&
    preview.channel?.platformName &&
    preview.draft?.hook &&
    preview.draft?.body &&
    preview.draft?.truthCheck === "passed" &&
    preview.provenance?.analysis?.provider &&
    preview.provenance?.content?.provider
  );
}

export function createPreviewHandoff(
  url: string,
  preview: GuestPreviewResult,
  nowMs = Date.now()
): PreviewHandoff {
  return {
    version: 2,
    url,
    preview,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + PREVIEW_HANDOFF_TTL_MS).toISOString(),
  };
}

export function parsePreviewHandoff(
  raw: unknown,
  nowMs = Date.now()
): PreviewHandoff | null {
  if (!raw || typeof raw !== "object") return null;
  const handoff = raw as Partial<PreviewHandoff>;
  const expiresAt = Date.parse(handoff.expiresAt ?? "");
  if (
    handoff.version !== 2 ||
    typeof handoff.url !== "string" ||
    handoff.url.length < 4 ||
    handoff.url.length > 2048 ||
    !isPreview(handoff.preview) ||
    handoff.url !== handoff.preview.source.url ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= nowMs
  ) {
    return null;
  }
  return handoff as PreviewHandoff;
}

/** Keep a guest result through a same-browser OAuth/magic-link round trip.
 * It is separate from the autosave draft and never implies account ownership. */
export function savePreviewHandoff(handoff: PreviewHandoff): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(handoff));
    return true;
  } catch {
    return false;
  }
}

export function loadPreviewHandoff(nowMs = Date.now()): PreviewHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const serialized = localStorage.getItem(KEY);
    if (!serialized) return null;
    const handoff = parsePreviewHandoff(JSON.parse(serialized), nowMs);
    if (!handoff) localStorage.removeItem(KEY);
    return handoff;
  } catch {
    return null;
  }
}

export function clearPreviewHandoff(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // A failed clear must not crash sign-out or account-boundary cleanup.
  }
}

function randomNonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Bind a stored preview to the authentication round trip the visitor starts
 * from the preview screen. The nonce is also carried in the callback URL, so
 * an unrelated account session cannot discover a leftover preview. */
export function markPreviewHandoffAuthPending(nowMs = Date.now()): string | null {
  const handoff = loadPreviewHandoff(nowMs);
  if (!handoff) return null;
  const authNonce = randomNonce();
  const next: PreviewHandoff = {
    ...handoff,
    authNonce,
    authExpiresAt: new Date(nowMs + PREVIEW_AUTH_TTL_MS).toISOString(),
  };
  return savePreviewHandoff(next) ? authNonce : null;
}

/** Consume exactly one matching auth handoff. It is removed from durable
 * browser storage immediately; a failed account save may still be retried from
 * the in-memory handoff in the current page, but not exposed on a later login. */
export function consumePreviewHandoffForAuthReturn(
  authNonce: string,
  nowMs = Date.now()
): PreviewHandoff | null {
  const handoff = loadPreviewHandoff(nowMs);
  const authExpiresAt = Date.parse(handoff?.authExpiresAt ?? "");
  if (
    !handoff ||
    !authNonce ||
    handoff.authNonce !== authNonce ||
    !Number.isFinite(authExpiresAt) ||
    authExpiresAt <= nowMs
  ) {
    return null;
  }
  clearPreviewHandoff();
  return handoff;
}

/** A guest preview may cross only the initial authentication redirect. Once a
 * real account identity has existed, sign-out or switching accounts clears it. */
export function shouldClearPreviewHandoff(
  previousUserId: string | null | undefined,
  nextUserId: string | null
): boolean {
  return typeof previousUserId === "string" && previousUserId !== nextUserId;
}
