import { NextRequest, NextResponse } from "next/server";
import { createGuestPreview, normalizeGuestPreviewUrl } from "@/lib/guestPreview";
import {
  guestPreviewConfig,
  guestPreviewProviderCapability,
} from "@/lib/guestPreviewConfig";
import {
  configuredGuestPreviewQuotaStore,
  GuestPreviewLimitError,
  reserveGuestPreviewQuota,
} from "@/lib/guestPreviewQuota";
import {
  guestPreviewQuotaIdentity,
  resolveGuestPreviewIdentity,
} from "@/lib/guestPreviewToken";
import { apiError, guestPreviewBodySchema, parseBody, readJsonBody } from "@/lib/validate";
import { PublicError } from "@/lib/errors";

export const maxDuration = 300;

const COOKIE = "postbeacon_guest_preview";
const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

interface PendingCookie {
  token: string;
  maxAge: number;
}

function assertSameOrigin(req: NextRequest): void {
  const fetchSite = req.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite === "cross-site" || (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite))) {
    throw new PublicError("Cross-site preview requests are not allowed.", 403);
  }
  const origin = req.headers.get("origin");
  if (!origin) return;
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new PublicError("Cross-site preview requests are not allowed.", 403);
  }
  if (parsedOrigin.origin !== origin || parsedOrigin.origin !== new URL(req.url).origin) {
    throw new PublicError("Cross-site preview requests are not allowed.", 403);
  }
}

function attachCookie(response: NextResponse, pending: PendingCookie | null): NextResponse {
  if (!pending) return response;
  response.headers.set("Vary", "Cookie");
  response.cookies.set(COOKIE, pending.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: pending.maxAge,
  });
  return response;
}

export async function POST(req: NextRequest) {
  let pendingCookie: PendingCookie | null = null;
  try {
    assertSameOrigin(req);
    const config = guestPreviewConfig();
    const { url, deepseekConsent } = parseBody(
      guestPreviewBodySchema,
      await readJsonBody(req, 4096)
    );
    const normalizedUrl = normalizeGuestPreviewUrl(url);
    const nowMs = Date.now();
    const identity = resolveGuestPreviewIdentity(
      req.cookies.get(COOKIE)?.value,
      config.secret,
      nowMs,
      config.tokenMaxAgeSeconds
    );
    pendingCookie = { token: identity.token, maxAge: config.tokenMaxAgeSeconds };

    const capability = guestPreviewProviderCapability();
    if (capability.deepseek.priorWarningRequired && deepseekConsent !== true) {
      throw new PublicError(
        "Confirm the DeepSeek data notice before using guest preview.",
        400
      );
    }

    const store = configuredGuestPreviewQuotaStore();
    if (!store) throw new PublicError("Guest preview is unavailable.", 503);
    await reserveGuestPreviewQuota(store, {
      visitorKey: guestPreviewQuotaIdentity(identity.id, config.secret),
      nowMs,
      windowSeconds: config.windowSeconds,
      perVisitorLimit: config.perVisitorLimit,
      globalLimit: config.globalLimit,
    });

    const preview = await createGuestPreview(normalizedUrl, config.provider);
    const response = NextResponse.json(preview, {
      headers: { "Cache-Control": "no-store" },
    });
    return attachCookie(response, pendingCookie);
  } catch (error) {
    const response = apiError(error, "Guest preview failed");
    response.headers.set("Cache-Control", "no-store");
    if (error instanceof GuestPreviewLimitError) {
      response.headers.set("Retry-After", String(error.retryAfterSeconds));
    }
    return attachCookie(response, pendingCookie);
  }
}
