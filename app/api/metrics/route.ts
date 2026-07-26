import { NextRequest, NextResponse } from "next/server";
import { bearer } from "@/lib/auth";
import { logError } from "@/lib/log";
import { buildProductMetrics, loadProductMetricRows } from "@/lib/productMetrics";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Operator-only aggregate product health. It shares the CRON_SECRET gate with
 * retention/reminders, selects no content or metric values, and returns no
 * account identifiers. Intended for an occasional operator check, not a user
 * dashboard.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: "Product metrics are not configured." }, 503);
  if (bearer(req) !== secret) return json({ error: "Unauthorized." }, 401);

  const sb = getServiceSupabase();
  if (!sb) return json({ error: "Product metrics are not configured." }, 503);

  try {
    return json(buildProductMetrics(await loadProductMetricRows(sb)));
  } catch (error) {
    logError("product-metrics", error);
    return json({ error: "Product metrics could not be calculated." }, 500);
  }
}
