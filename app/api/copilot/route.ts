import { NextRequest, NextResponse } from "next/server";
import { runCopilot } from "@/lib/copilot";
import { getPlatforms } from "@/lib/platforms";
import { guardRoute } from "@/lib/usage";
import type {
  CopilotAction,
  CopilotMessage,
  GenerateResult,
  MarketingStrategy,
  ProductProfile,
  Provider,
} from "@/lib/types";

export const maxDuration = 120;

const ACTIONS = new Set<CopilotAction>([
  "explain-plan",
  "next-steps",
  "improve-posts",
  "rewrite",
  "first-replies",
  "review-feedback",
  "ask",
]);

export async function POST(req: NextRequest) {
  try {
    const guard = await guardRoute(req);
    if ("response" in guard) return guard.response;

    const {
      provider,
      profile,
      strategy,
      result,
      launchDate,
      action,
      question,
      targetPlatformId,
      history,
    } = (await req.json()) as {
      provider?: Provider;
      profile?: ProductProfile;
      strategy?: MarketingStrategy;
      result?: GenerateResult | null;
      launchDate?: string;
      action?: CopilotAction;
      question?: string;
      targetPlatformId?: string;
      history?: CopilotMessage[];
    };

    if (!profile) {
      return NextResponse.json({ error: "Missing profile" }, { status: 400 });
    }
    if (!strategy) {
      return NextResponse.json({ error: "Missing strategy" }, { status: 400 });
    }
    if (!action || !ACTIONS.has(action)) {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    if (action === "rewrite" || action === "first-replies") {
      if (!targetPlatformId) {
        return NextResponse.json({ error: "Missing targetPlatformId" }, { status: 400 });
      }
      if (getPlatforms([targetPlatformId]).length === 0) {
        return NextResponse.json(
          { error: `Unknown platform: ${targetPlatformId}` },
          { status: 400 }
        );
      }
      const drafted =
        Array.isArray(result?.content) &&
        result.content.some((c) => c?.platformId === targetPlatformId);
      if (!drafted) {
        return NextResponse.json(
          { error: "No drafted posts for that platform yet." },
          { status: 400 }
        );
      }
    }
    if (action === "improve-posts" && !(Array.isArray(result?.content) && result.content.length)) {
      return NextResponse.json({ error: "Generate content first." }, { status: 400 });
    }
    if (
      (action === "ask" || action === "review-feedback") &&
      !(typeof question === "string" && question.trim())
    ) {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    const reply = await runCopilot({
      provider,
      profile,
      strategy,
      result,
      launchDate,
      action,
      question,
      targetPlatformId,
      history: Array.isArray(history) ? history.slice(-6) : [],
    });
    return NextResponse.json(reply);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Copilot failed" },
      { status: 500 }
    );
  }
}
