import { NextRequest, NextResponse } from "next/server";
import { generateJson } from "@/lib/llm";
import { getPlatforms } from "@/lib/platforms";
import type {
  Provider,
  ProductProfile,
  PlatformContent,
  ScheduleItem,
  GenerateResult,
} from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { profile, platformIds, provider } = (await req.json()) as {
      profile?: ProductProfile;
      platformIds?: string[];
      provider?: Provider;
    };
    if (!profile || !platformIds?.length) {
      return NextResponse.json(
        { error: "Missing profile or platformIds" },
        { status: 400 }
      );
    }

    const platforms = getPlatforms(platformIds);
    const profileBlock = JSON.stringify(profile, null, 2);

    // Generate content per platform in parallel — each platform has its own voice.
    const content: PlatformContent[] = await Promise.all(
      platforms.map(async (p) => {
        const data = await generateJson({
          provider,
          maxTokens: 2500,
          system: `You are a Chief Marketing Officer writing launch content for ${p.name}. Match the platform's native voice exactly. ${p.guidance}`,
          user: `Product profile:
${profileBlock}

Write ${p.postCount} ready-to-post piece(s) for ${p.name}. Each must feel native to the platform and be copy-paste ready.

Return JSON: { "posts": [ { "hook": string, "body": string, "imageSuggestion": string, "bestTime": string, "caveats": string } ] }
- "hook": the headline / first line / tagline (whatever leads on this platform)
- "body": the full post, ready to paste
- "imageSuggestion": what visual to attach
- "bestTime": ideal posting time (default to "${p.bestTime}")
- "caveats": the #1 platform-specific thing to NOT do`,
        });

        return {
          platformId: p.id,
          platformName: p.name,
          posts: Array.isArray(data.posts) ? data.posts : [],
        };
      })
    );

    // Build a deterministic launch sequence from the platform playbook.
    const schedule: ScheduleItem[] = platforms
      .map((p) => ({
        day: p.defaultDay,
        platformId: p.id,
        platformName: p.name,
        action: `Post to ${p.name} — ${p.blurb} (${p.bestTime})`,
      }))
      .sort((a, b) => a.day - b.day);

    const result: GenerateResult = { content, schedule };
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Generate failed" },
      { status: 500 }
    );
  }
}
