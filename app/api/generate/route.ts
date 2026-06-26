import { NextRequest, NextResponse } from "next/server";
import { generatePlatformPosts } from "@/lib/generate";
import { getPlatforms } from "@/lib/platforms";
import { authConfigured, meteringEnabled } from "@/lib/supabase/server";
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

export const maxDuration = 300;

// Run async work over `items` with a concurrency ceiling — keeps "select every
// channel" from firing 20 LLM calls at once (provider rate-limits + memory), and
// preserves input order in the result.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

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

    // Require sign-in once accounts are configured (protects the model budget).
    // Meter the free-launch limit only when a service-role key is present. Both
    // are no-ops when Supabase is unconfigured, so the keyless app stays open.
    let userId: string | null = null;
    if (authConfigured()) {
      const user = await getUserFromRequest(req);
      if (!user) {
        return NextResponse.json(
          { error: "Sign in to generate your launch content.", code: "auth" },
          { status: 401 }
        );
      }
      userId = user.id;
      if (meteringEnabled()) {
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
      }
    }

    const platforms = getPlatforms(platformIds);

    // Generate content per platform (each has its own voice), capped at 6
    // concurrent calls so large selections stay within the time/rate budget.
    const content: PlatformContent[] = await mapLimit(platforms, 6, async (p) => {
      const { posts, playbook } = await generatePlatformPosts(profile, p, provider);
      return { platformId: p.id, platformName: p.name, posts, playbook };
    });

    // Build a deterministic launch sequence from the platform playbook.
    const schedule: ScheduleItem[] = platforms
      .map((p) => ({
        day: p.defaultDay,
        platformId: p.id,
        platformName: p.name,
        action: `Post to ${p.name} — ${p.blurb} (${p.bestTime})`,
      }))
      .sort((a, b) => a.day - b.day);

    if (userId && meteringEnabled()) await incrementLaunch(userId);

    const result: GenerateResult = { content, schedule };
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Generate failed" },
      { status: 500 }
    );
  }
}
