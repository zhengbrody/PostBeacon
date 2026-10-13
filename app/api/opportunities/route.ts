import { NextRequest, NextResponse } from "next/server";
import { guardRoute } from "@/lib/usage";
import { runOpportunityResearch } from "@/lib/opportunityResearchServer";
import {
  apiError,
  opportunityResearchBodySchema,
  parseBody,
  readJsonBody,
} from "@/lib/validate";
import { PublicError } from "@/lib/errors";

export const maxDuration = 60;
export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin)
      throw new PublicError("Use the same-origin product workspace.", 403);
    const guard = await guardRoute(req);
    if ("response" in guard) return guard.response;
    // A new spend surface must not inherit the historical keyless/open mode.
    if (!guard.userId)
      throw new PublicError(
        "Source research requires configured accounts and sign-in.",
        503
      );
    const body = parseBody(opportunityResearchBodySchema, await readJsonBody(req, 64_000));
    const research = await runOpportunityResearch(body);
    return NextResponse.json(research, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return apiError(err, "Source research failed. Your existing plan is unchanged.");
  }
}
