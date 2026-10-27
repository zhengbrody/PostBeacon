import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/usage";
import { getServiceSupabase } from "@/lib/supabase/server";
import { PublicError } from "@/lib/errors";
import { apiError, parseBody, readJsonBody } from "@/lib/validate";
import { bufferDeliveryCommandSchema } from "@/lib/bufferPublishing";
import {
  approveBufferDelivery,
  bufferPublishingEnabled,
  cancelBufferDelivery,
  listBufferDeliveries,
  prepareBufferDelivery,
  reconcileBufferDelivery,
} from "@/lib/bufferPublishingServer";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
const json = (value: unknown) =>
  NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
async function caller(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin)
    throw new PublicError("Use the same-origin publishing workspace.", 403);
  const user = await getUserFromRequest(req);
  if (!user) throw new PublicError("Sign in to manage approved scheduling.", 401);
  const sb = getServiceSupabase();
  if (!sb) throw new PublicError("Approved scheduling requires persistent storage.", 503);
  return { userId: user.id, sb };
}
export async function GET(req: NextRequest) {
  try {
    const { userId, sb } = await caller(req),
      projectId = parseBody(z.uuid(), req.nextUrl.searchParams.get("projectId"));
    return json({
      enabled: bufferPublishingEnabled(),
      deliveries: await listBufferDeliveries(sb, userId, projectId),
    });
  } catch (error) {
    return apiError(error, "Publishing receipts could not be loaded.");
  }
}
export async function POST(req: NextRequest) {
  try {
    const { userId, sb } = await caller(req),
      command = parseBody(bufferDeliveryCommandSchema, await readJsonBody(req, 12000));
    if (command.action !== "cancel-local" && !bufferPublishingEnabled())
      throw new PublicError("Approved scheduling is not enabled. No post was sent.", 503);
    const delivery =
      command.action === "prepare"
        ? await prepareBufferDelivery(sb, userId, command)
        : command.action === "approve"
          ? await approveBufferDelivery(
              sb,
              userId,
              command.deliveryId,
              command.approvalHash
            )
          : command.action === "cancel-local"
            ? await cancelBufferDelivery(sb, userId, command.deliveryId)
            : await reconcileBufferDelivery(sb, userId, command.deliveryId);
    return json({ enabled: bufferPublishingEnabled(), delivery });
  } catch (error) {
    return apiError(
      error,
      "Publishing receipt could not be updated. Check Buffer before resending an uncertain post."
    );
  }
}
