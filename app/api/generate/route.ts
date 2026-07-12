import { NextRequest, NextResponse } from "next/server";
import { generatePlatformPosts } from "@/lib/generate";
import { getPlatforms } from "@/lib/platforms";
import { billingEnabled } from "@/lib/supabase/server";
import {
  guardRoute,
  getEntitlement,
  canLaunch,
  incrementLaunch,
  FREE_LAUNCHES,
} from "@/lib/usage";
import { apiError, generateBodySchema, parseBody, readJsonBody } from "@/lib/validate";
import { PublicError, publicMessage } from "@/lib/errors";
import type {
  PlatformContent,
  ScheduleItem,
  GenerateResult,
  GenerationFailure,
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
    // Require sign-in + daily cap (protects the model budget). No-ops when
    // Supabase is unconfigured, so the keyless app stays open.
    const guard = await guardRoute(req);
    if ("response" in guard) return guard.response;
    const userId = guard.userId;

    // platformIds arrive deduped, bounded, and catalog-known from the schema.
    const { profile, platformIds, provider, facts } = parseBody(
      generateBodySchema,
      await readJsonBody(req)
    );

    // Lifetime free-launch paywall — only once billing (Polar) is wired up, so
    // the free beta isn't paywalled by merely turning metering on.
    if (userId && billingEnabled()) {
      const ent = await getEntitlement(userId);
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

    const platforms = getPlatforms(platformIds);

    // Generate content per platform (each has its own voice), capped at 6
    // concurrent calls. Partial success by design: one channel failing must
    // never sink the others — failures come back listed and retryable.
    const outcomes = await mapLimit(platforms, 6, async (p) => {
      try {
        const { posts, playbook, meta } = await generatePlatformPosts(
          profile,
          p,
          provider,
          facts
        );
        const ok: PlatformContent = {
          platformId: p.id,
          platformName: p.name,
          posts,
          playbook,
          meta,
        };
        return { ok };
      } catch (err) {
        // Config errors (no API key) abort the whole run — every channel
        // would fail identically, so partial semantics add nothing.
        if (err instanceof PublicError && err.status === 503) throw err;
        const failure: GenerationFailure = {
          platformId: p.id,
          platformName: p.name,
          error: publicMessage(err, "Generation failed for this channel."),
        };
        return { failure };
      }
    });

    const content = outcomes.flatMap((o) => (o.ok ? [o.ok] : []));
    const failures = outcomes.flatMap((o) => (o.failure ? [o.failure] : []));

    if (!content.length) {
      return NextResponse.json(
        { error: "Generation failed for every selected channel. Try again." },
        { status: 502 }
      );
    }

    // Deterministic launch sequence — only for channels that actually have content.
    const generated = new Set(content.map((c) => c.platformId));
    const schedule: ScheduleItem[] = platforms
      .filter((p) => generated.has(p.id))
      .map((p) => ({
        day: p.defaultDay,
        platformId: p.id,
        platformName: p.name,
        action: `Post to ${p.name} — ${p.blurb} (${p.bestTime})`,
      }))
      .sort((a, b) => a.day - b.day);

    if (userId && billingEnabled()) await incrementLaunch(userId);

    const result: GenerateResult = { content, schedule, failures };
    return NextResponse.json(result);
  } catch (err) {
    return apiError(err, "Generate failed");
  }
}
