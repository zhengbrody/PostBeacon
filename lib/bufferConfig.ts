import { PublicError } from "./errors";

export const BUFFER_SCOPES = [
  "account:read",
  "posts:read",
  "posts:write",
  "offline_access",
];
export interface BufferConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}
export function bufferSetupIssues(): string[] {
  const issues: string[] = [];
  if (process.env.BUFFER_PUBLISHING_ENABLED !== "true")
    issues.push("Publishing is not enabled by the operator.");
  if (!process.env.BUFFER_CLIENT_ID?.trim())
    issues.push("Buffer app client is not configured.");
  if (!process.env.BUFFER_CLIENT_SECRET?.trim())
    issues.push("Buffer app credentials are not configured.");
  const raw = process.env.BUFFER_TOKEN_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64") !== raw)
    issues.push("Credential encryption is not configured.");
  const redirect = process.env.BUFFER_REDIRECT_URI ?? "";
  let valid = redirect === "https://postbeacon.app/api/buffer/callback";
  if (!valid && process.env.NODE_ENV !== "production") {
    try {
      const url = new URL(redirect);
      valid =
        url.protocol === "https:" &&
        url.hostname === "localhost" &&
        url.pathname === "/api/buffer/callback" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash;
    } catch {
      /* Invalid configuration stays disabled. */
    }
  }
  if (!valid) issues.push("The registered Buffer callback is not configured safely.");
  return issues;
}
export const bufferPublishingEnabled = () => bufferSetupIssues().length === 0;
export function requireBufferConfig(): BufferConfig {
  if (!bufferPublishingEnabled())
    throw new PublicError(
      "Buffer publishing is unavailable. No provider request was sent.",
      503
    );
  return {
    clientId: process.env.BUFFER_CLIENT_ID!.trim(),
    clientSecret: process.env.BUFFER_CLIENT_SECRET!.trim(),
    redirectUri: process.env.BUFFER_REDIRECT_URI!,
  };
}
