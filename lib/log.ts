/**
 * The ONLY sanctioned logging sink (M17). App code has zero bare `console.*`
 * calls — enforced by ESLint `no-console` — because logs must never contain
 * emails, URL query strings, tokens, prompts, or post bodies. Routes that
 * genuinely need an ops breadcrumb call logError(), which logs a scope plus a
 * REDACTED one-line summary of the error and nothing else. Never pass user
 * input, request bodies, or prompt text into it.
 */

const MAX_LEN = 300;

/** Strip anything that could identify a user or unlock an account. */
export function redact(text: string): string {
  return (
    text
      // Log injection: collapse to one line before anything else.
      .replace(/[\r\n\t]+/g, " ")
      // Bearer credentials however they were embedded.
      .replace(/Bearer\s+[\w.~+/-]+=*/gi, "Bearer [redacted]")
      // JWTs (three base64url segments).
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[jwt]")
      // Common API-key shapes (sk-…, key-ish long tokens with a known prefix).
      .replace(/\b(sk|pk|rk|key|token|secret)[-_][\w-]{16,}\b/gi, "[key]")
      // Resend server keys use an `re_` prefix rather than the generic shapes above.
      .replace(/\bre_[\w-]{16,}\b/g, "[key]")
      // Email addresses.
      .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[email]")
      // URL query strings + fragments (may carry tokens or personal data).
      .replace(/([?#])[^\s"'()]*/g, "$1[redacted]")
      .slice(0, MAX_LEN)
  );
}

/**
 * Log an error for operators without leaking user data. `scope` is a static
 * string you write (e.g. "account.delete"); the error is reduced to its
 * name + redacted message — stacks, causes, and response bodies are dropped.
 */
export function logError(scope: string, err: unknown): void {
  const name = err instanceof Error ? err.name : typeof err;
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`[${scope}] ${name}: ${redact(message)}`);
}
