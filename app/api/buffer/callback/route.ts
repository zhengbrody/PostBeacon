import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { requireBufferConfig } from "@/lib/bufferConfig";
import { stageBufferCallback, BUFFER_BINDING_COOKIE } from "@/lib/bufferConnectionServer";

export const dynamic = "force-dynamic";
/** No session bearer is available on a provider callback. Stage only an encrypted
 * code after state+cookie checks; finish requires the current authenticated owner. */
export async function GET(req: NextRequest) {
  let target = "https://postbeacon.app/app?buffer=error";
  try {
    const config = requireBufferConfig();
    target = new URL("/app?buffer=error", config.redirectUri).toString();
    if (req.nextUrl.origin !== new URL(config.redirectUri).origin)
      throw new Error("Callback origin mismatch");
    const sb = getServiceSupabase();
    if (!sb || req.nextUrl.searchParams.has("error"))
      throw new Error("Authorization unavailable");
    await stageBufferCallback(
      sb,
      req.nextUrl.searchParams.get("state") ?? "",
      req.cookies.get(BUFFER_BINDING_COOKIE)?.value ?? "",
      req.nextUrl.searchParams.get("code") ?? ""
    );
    target = new URL("/app?buffer=finish", config.redirectUri).toString();
  } catch {
    /* Never reflect provider codes, query strings or credential errors. */
  }
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
