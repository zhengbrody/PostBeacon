import { NextRequest, NextResponse } from "next/server";
import { runCopilot } from "@/lib/copilot";
import { getPlatforms } from "@/lib/platforms";
import { guardRoute } from "@/lib/usage";
import { apiError, copilotBodySchema, parseBody, readJsonBody } from "@/lib/validate";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const guard = await guardRoute(req);
    if ("response" in guard) return guard.response;

    const body = parseBody(copilotBodySchema, await readJsonBody(req));
    const { action, question, targetPlatformId, result } = body;

    // Cross-field rules the schema can't express: some actions need a target
    // platform with drafted posts, others need a question.
    if (action === "rewrite" || action === "first-replies") {
      if (!targetPlatformId) {
        return NextResponse.json({ error: "Missing targetPlatformId" }, { status: 400 });
      }
      if (getPlatforms([targetPlatformId]).length === 0) {
        return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
      }
      const drafted = result?.content.some((c) => c.platformId === targetPlatformId);
      if (!drafted) {
        return NextResponse.json(
          { error: "No drafted posts for that platform yet." },
          { status: 400 }
        );
      }
    }
    if (action === "improve-posts" && !result?.content.length) {
      return NextResponse.json({ error: "Generate content first." }, { status: 400 });
    }
    if ((action === "ask" || action === "review-feedback") && !question?.trim()) {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    const reply = await runCopilot({
      provider: body.provider,
      profile: body.profile,
      strategy: body.strategy,
      result: body.result,
      facts: body.facts,
      workspace: body.workspace,
      memory: body.memory,
      launchDate: body.launchDate,
      action,
      question,
      targetPlatformId,
      history: (body.history ?? []).slice(-6),
    });
    return NextResponse.json(reply);
  } catch (err) {
    return apiError(err, "Copilot failed");
  }
}
