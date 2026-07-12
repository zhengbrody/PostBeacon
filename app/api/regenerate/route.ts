import { NextRequest, NextResponse } from "next/server";
import { generatePlatformPosts } from "@/lib/generate";
import { getPlatforms } from "@/lib/platforms";
import { guardRoute } from "@/lib/usage";
import { apiError, parseBody, readJsonBody, regenerateBodySchema } from "@/lib/validate";

export const maxDuration = 120;

// Re-write the content for a single platform (the "Regenerate" button in results).
// Doesn't consume a launch credit, but requires sign-in when metering is on.
export async function POST(req: NextRequest) {
  try {
    const guard = await guardRoute(req);
    if ("response" in guard) return guard.response;

    // platformId is schema-checked against the catalog, so this can't be empty.
    const { profile, platformId, provider } = parseBody(
      regenerateBodySchema,
      await readJsonBody(req)
    );
    const [p] = getPlatforms([platformId]);

    const { posts, playbook } = await generatePlatformPosts(profile, p, provider);
    return NextResponse.json({ posts, playbook });
  } catch (err) {
    return apiError(err, "Regenerate failed");
  }
}
