import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/usage";
import { getServiceSupabase } from "@/lib/supabase/server";
import { PublicError } from "@/lib/errors";
import { apiError, parseBody, readJsonBody } from "@/lib/validate";
import { agentMissionCommandSchema } from "@/lib/agentMissions";
import {
  agentMissionsEnabled,
  readAgentMission,
  saveAgentMission,
  pauseAgentMission,
  reserveAgentMissionRun,
} from "@/lib/agentMissionServer";
import { executeAgentRun } from "@/lib/agentRunServer";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
const json = (data: unknown) =>
  NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
async function caller(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin)
    throw new PublicError("Use the same-origin product workspace.", 403);
  const user = await getUserFromRequest(req);
  if (!user) throw new PublicError("Sign in to manage daily research.", 401);
  return user;
}
export async function GET(req: NextRequest) {
  try {
    const user = await caller(req);
    const projectId = parseBody(z.uuid(), req.nextUrl.searchParams.get("projectId"));
    const enabled = agentMissionsEnabled(),
      sb = getServiceSupabase();
    if (!sb) {
      throw new PublicError("Daily research requires verified persistent storage.", 503);
    }
    return json({ enabled, mission: await readAgentMission(sb, user.id, projectId) });
  } catch (error) {
    return apiError(error, "Daily research could not be loaded.");
  }
}
export async function POST(req: NextRequest) {
  try {
    const user = await caller(req);
    const command = parseBody(agentMissionCommandSchema, await readJsonBody(req, 64000));
    // Revocation remains available when flags/keys have been switched off.
    if (
      command.action !== "pause" &&
      (process.env.AGENT_MISSIONS_ENABLED !== "true" ||
        process.env.AGENT_RUNS_ENABLED !== "true")
    )
      throw new PublicError(
        "Daily research is not enabled. No work has been scheduled.",
        503
      );
    const sb = getServiceSupabase();
    if (!sb)
      throw new PublicError("Daily research requires verified persistent storage.", 503);
    if (command.action === "pause")
      return json({
        enabled: agentMissionsEnabled(),
        mission: await pauseAgentMission(sb, user.id, command.projectId),
      });
    if (command.action === "save")
      return json({
        enabled: agentMissionsEnabled(),
        mission: await saveAgentMission(sb, user.id, command),
      });
    const mission = await readAgentMission(sb, user.id, command.projectId);
    if (!mission)
      throw new PublicError("Authorize a daily mission before running it.", 409);
    const run = await reserveAgentMissionRun(
      sb,
      user.id,
      mission,
      command.contextKey,
      command.expectedRevision
    );
    if (run.status === "queued") after(() => executeAgentRun(sb, user.id, run.id));
    return json({ enabled: true, mission, run });
  } catch (error) {
    return apiError(error, "Daily research could not be changed. Your plan is unchanged.");
  }
}
