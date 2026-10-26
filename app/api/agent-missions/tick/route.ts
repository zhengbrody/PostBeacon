import { after, NextRequest, NextResponse } from "next/server";
import { bearer } from "@/lib/auth";
import { PublicError } from "@/lib/errors";
import { apiError } from "@/lib/validate";
import { getServiceSupabase } from "@/lib/supabase/server";
import { agentMissionsEnabled, reserveDueAgentMissions } from "@/lib/agentMissionServer";
import { executeAgentRun } from "@/lib/agentRunServer";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: "Daily research dispatch is not configured." }, 503);
  if (bearer(req) !== secret) return json({ error: "Unauthorized." }, 401);
  try {
    if (!agentMissionsEnabled()) return json({ enabled: false, reserved: 0, skipped: 0 });
    const sb = getServiceSupabase();
    if (!sb)
      throw new PublicError("Daily research requires verified persistent storage.", 503);
    const { reserved, skipped } = await reserveDueAgentMissions(sb);
    if (reserved.length)
      after(async () => {
        await Promise.all(reserved.map((run) => executeAgentRun(sb, run.userId, run.id)));
      });
    return json({ enabled: true, reserved: reserved.length, skipped });
  } catch (error) {
    return apiError(error, "Daily research dispatch failed. No automatic retry.");
  }
}
