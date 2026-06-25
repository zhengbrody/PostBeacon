import type { NextRequest } from "next/server";

/** Pull the bearer token out of a request's Authorization header. */
export function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}
