import { NextRequest, NextResponse } from "next/server";
import { generatePlatformPosts } from "@/lib/generate";
import { getPlatforms } from "@/lib/platforms";
import { meteringEnabled } from "@/lib/supabase/server";
import {
  getUserFromRequest,
  getEntitlement,
  canLaunch,
  incrementLaunch,
  FREE_LAUNCHES,
} from "@/lib/usage";
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

    // Server-enforced metering (only when a service-role key is configured).
    let userId: string | null = null;
    if (meteringEnabled()) {
      const user = await getUserFromRequest(req);
      if (!user) {
        return NextResponse.json(
          { error: "Sign in to generate your launch content.", code: "auth" },
          { status: 401 }
        );
      }
      const ent = await getEntitlement(user.id);
      if (!canLaunch(ent)) {
        return NextResponse.json(
          {
            error: `You've used your ${FREE_LAUNCHES} free launches. Upgrade to Pro for unlimited.`,
            code: "paywall",
          },
          { status: 402 }
        );
      }
      userId = user.id;
    }

    const platforms = getPlatforms(platformIds);

    // Generate content per platform in parallel — each platform has its own voice.
    const content: PlatformContent[] = await Promise.all(
      platforms.map(async (p) => {
        const { posts, playbook } = await generatePlatformPosts(
          profile,
          p,
          provider
        );
        return { platformId: p.id, platformName: p.name, posts, playbook };
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

    if (userId) await incrementLaunch(userId);

    const result: GenerateResult = { content, schedule };
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Generate failed" },
      { status: 500 }
    );
  }
}
