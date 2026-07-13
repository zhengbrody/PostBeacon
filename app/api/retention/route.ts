import { NextRequest, NextResponse } from "next/server";
import { bearer } from "@/lib/auth";
import { logError } from "@/lib/log";
import { retentionDays } from "@/lib/privacy";
import { runRetention } from "@/lib/retention";
import { getServiceSupabase } from "@/lib/supabase/server";

// GET /api/retention — the operator-configured retention sweep (M17), meant to
// be hit by Vercel Cron (which sends `Authorization: Bearer ${CRON_SECRET}`).
// Auth fails closed: no CRON_SECRET configured → 503; wrong secret → 401.
// The sweep itself is opt-in: without RETENTION_DAYS (the same value the
// /privacy page renders) or a service-role key it reports {enabled:false}
// and deletes nothing.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Retention is not configured." }, { status: 503 });
  }
  if (bearer(req) !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const days = retentionDays();
  const sb = getServiceSupabase();
  if (!days || !sb) return NextResponse.json({ enabled: false });

  try {
    return NextResponse.json(await runRetention(sb, days));
  } catch (err) {
    logError("retention", err);
    return NextResponse.json({ error: "Retention sweep failed." }, { status: 500 });
  }
}
