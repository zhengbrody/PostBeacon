import { NextRequest, NextResponse } from "next/server";
import { guardRoute } from "@/lib/usage";
import { draftOutreachMessages } from "@/lib/outreachServer";
import { apiError, parseBody, readJsonBody, outreachBodySchema } from "@/lib/validate";
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
        "Message drafting requires configured accounts and sign-in. You can still write the message yourself.",
        503
      );
    const body = parseBody(outreachBodySchema, await readJsonBody(req, 64_000));
    const drafted = await draftOutreachMessages(body);
    return NextResponse.json(drafted, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return apiError(err, "Message drafting failed. Your list is unchanged.");
  }
}
