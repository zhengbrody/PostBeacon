import { NextRequest, NextResponse } from "next/server";
import { generatePlatformPosts } from "@/lib/generate";
import { getPlatforms } from "@/lib/platforms";
import { guardRoute } from "@/lib/usage";
import type { Provider, ProductProfile } from "@/lib/types";

export const maxDuration = 120;

// Re-write the content for a single platform (the "Regenerate" button in results).
// Doesn't consume a launch credit, but requires sign-in when metering is on.
export async function POST(req: NextRequest) {
  try {
    const { profile, platformId, provider } = (await req.json()) as {
      profile?: ProductProfile;
      platformId?: string;
      provider?: Provider;
    };
    if (!profile || !platformId) {
      return NextResponse.json(
        { error: "Missing profile or platformId" },
        { status: 400 }
      );
    }

    const guard = await guardRoute(req);
    if ("response" in guard) return guard.response;

    const [p] = getPlatforms([platformId]);
    if (!p) {
      return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
    }

    const { posts, playbook } = await generatePlatformPosts(profile, p, provider);
    return NextResponse.json({ posts, playbook });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Regenerate failed" },
      { status: 500 }
    );
  }
}
