import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/usage";
import { getServiceSupabase } from "@/lib/supabase/server";
import { apiError, parseBody, readJsonBody } from "@/lib/validate";
import { PublicError } from "@/lib/errors";
import { publicAgentRun } from "@/lib/agentRuns";
import {
  agentCommandSchema,
  executeAgentRun,
  reserveAgentRun,
  transitionAgentRun,
} from "@/lib/agentRunServer";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function caller(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin)
    throw new PublicError("Use the same-origin product workspace.", 403);
  const user = await getUserFromRequest(req);
  if (!user) throw new PublicError("Sign in to use Agent tasks.", 401);
  return user;
}
const json = (data: unknown) =>
  NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  try {
    const user = await caller(req);
    const projectId = parseBody(z.uuid(), req.nextUrl.searchParams.get("projectId"));
    if (process.env.AGENT_RUNS_ENABLED !== "true")
      return json({ enabled: false, runs: [] });
    const sb = getServiceSupabase();
    if (!sb) throw new PublicError("Agent tasks require verified persistent storage.", 503);
    const { data, error } = await sb
      .from("agent_runs")
      .select("*")
      .eq("user_id", user.id)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error)
      throw new PublicError(
        "Agent task storage is not ready. Verify the Agent migration before enabling it.",
        503
      );
    return json({
      enabled: true,
      runs: (data ?? []).flatMap((row) => {
        const run = publicAgentRun(row);
        return run ? [run] : [];
      }),
    });
  } catch (error) {
    return apiError(error, "Agent tasks could not be loaded.");
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await caller(req);
    if (process.env.AGENT_RUNS_ENABLED !== "true")
      throw new PublicError(
        "Persistent Agent tasks are not enabled yet. Your existing plan is unchanged.",
        503
      );
    const sb = getServiceSupabase();
    if (!sb) throw new PublicError("Agent tasks require verified persistent storage.", 503);
    const command = parseBody(agentCommandSchema, await readJsonBody(req, 64000));
    if (command.action === "start") {
      const run = await reserveAgentRun(sb, user.id, command);
      after(() => executeAgentRun(sb, user.id, run.id));
      return json(run);
    }
    if (command.action === "cancel") {
      const row = await transitionAgentRun(sb, user.id, command.runId, "cancel");
      if (!row) throw new PublicError("Agent task not found.", 404);
      return json(publicAgentRun(row));
    }
    // Resume never accepts a new payload, provider or model. Claim fencing decides
    // whether pre-model work may run; the acknowledgement does not claim completion.
    const { data, error } = await sb
      .from("agent_runs")
      .select("*")
      .eq("id", command.runId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new PublicError("Agent task storage is unavailable.", 503);
    const run = publicAgentRun(data);
    if (!run?.canResume)
      throw new PublicError(
        "This task cannot safely resume. A sent model request is never repeated automatically.",
        409
      );
    after(() => executeAgentRun(sb, user.id, run.id));
    return json(run);
  } catch (error) {
    return apiError(error, "Agent task could not be changed. Your plan is unchanged.");
  }
}
