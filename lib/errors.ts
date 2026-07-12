/**
 * Error channel for API routes. Anything we intentionally throw with a
 * user-safe message is a PublicError; routes surface its message + status
 * as-is and collapse every other error to a generic fallback so internals
 * (SDK errors, prompts, upstream bodies) never leak to the client.
 */
export class PublicError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = "PublicError";
  }
}

/** Thrown when a URL fails the SSRF policy (blocked host/IP/redirect target). */
export class BlockedUrlError extends PublicError {
  constructor(message: string) {
    super(message, 400);
    this.name = "BlockedUrlError";
  }
}

/** Gate codes the UI branches on (Paywall shows sign-in vs upgrade vs limit). */
export type ApiErrorCode = "auth" | "limit" | "paywall";

/** THE error body every API route returns — client and server share this shape. */
export interface ApiErrorBody {
  error: string;
  code?: ApiErrorCode;
}

/** The message safe to show an end user for this error. */
export function publicMessage(err: unknown, fallback: string): string {
  return err instanceof PublicError ? err.message : fallback;
}

/** The HTTP status to return for this error (500 unless intentionally public). */
export function publicStatus(err: unknown): number {
  return err instanceof PublicError ? err.status : 500;
}
