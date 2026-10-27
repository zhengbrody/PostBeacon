import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/usage";
import { getServiceSupabase } from "@/lib/supabase/server";
import { PublicError } from "@/lib/errors";
import { apiError, parseBody, readJsonBody } from "@/lib/validate";
import { bufferConnectionCommandSchema } from "@/lib/bufferConnections";
import { requireBufferConfig } from "@/lib/bufferConfig";
import {
  bufferConnectionList,
  beginBufferConnection,
  finishBufferConnection,
  refreshBufferChannels,
  disconnectBufferConnection,
  BUFFER_BINDING_COOKIE,
} from "@/lib/bufferConnectionServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (data: unknown) =>
  NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
async function caller(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin)
    throw new PublicError("Use the same-origin workspace.", 403);
  const user = await getUserFromRequest(req);
  if (!user) throw new PublicError("Sign in to manage Buffer connections.", 401);
  const sb = getServiceSupabase();
  if (!sb) throw new PublicError("Buffer requires verified persistent storage.", 503);
  return { user, sb };
}
export async function GET(req: NextRequest) {
  try {
    const { user, sb } = await caller(req);
    return json(await bufferConnectionList(sb, user.id));
  } catch (error) {
    return apiError(error, "Buffer connection could not be loaded.");
  }
}
export async function POST(req: NextRequest) {
  try {
    const { user, sb } = await caller(req);
    const command = parseBody(bufferConnectionCommandSchema, await readJsonBody(req, 2000));
    if (command.action !== "disconnect") requireBufferConfig();
    if (command.action === "connect") {
      const callbackOrigin = new URL(requireBufferConfig().redirectUri).origin;
      if (req.nextUrl.origin !== callbackOrigin)
        throw new PublicError(
          "Connect from https://postbeacon.app/app so the secure authorization cookie returns to the same site.",
          409
        );
      const started = await beginBufferConnection(sb, user.id);
      const response = json({
        ...(await bufferConnectionList(sb, user.id)),
        authorizationUrl: started.authorizationUrl,
      });
      response.cookies.set(BUFFER_BINDING_COOKIE, started.binding, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      });
      return response;
    }
    if (command.action === "finish")
      await finishBufferConnection(
        sb,
        user.id,
        req.cookies.get(BUFFER_BINDING_COOKIE)?.value ?? ""
      );
    else if (command.action === "refresh-channels")
      await refreshBufferChannels(sb, user.id);
    else await disconnectBufferConnection(sb, user.id);
    const response = json(await bufferConnectionList(sb, user.id));
    if (command.action === "finish" || command.action === "disconnect")
      response.cookies.set(BUFFER_BINDING_COOKIE, "", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    return response;
  } catch (error) {
    return apiError(error, "Buffer connection could not be changed.");
  }
}
