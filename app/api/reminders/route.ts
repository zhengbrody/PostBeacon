import { NextRequest, NextResponse } from "next/server";
import { bearer } from "@/lib/auth";
import { logError } from "@/lib/log";
import { reminderDeliveryConfigured, runReminderSweep } from "@/lib/reminders";
import { getServiceSupabase } from "@/lib/supabase/server";

// GET /api/reminders — daily, CRON_SECRET-authenticated, explicit-opt-in
// event reminders. It fails closed and sends nothing until every dependency
// is configured.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Reminders are not configured." }, { status: 503 });
  }
  if (bearer(req) !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const sb = getServiceSupabase();
  if (!reminderDeliveryConfigured() || !sb) {
    return NextResponse.json({ enabled: false });
  }

  try {
    return NextResponse.json(await runReminderSweep(sb));
  } catch (error) {
    logError("reminders", error);
    return NextResponse.json({ error: "Reminder sweep failed." }, { status: 500 });
  }
}
