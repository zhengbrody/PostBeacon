import type {
  ProductProfile,
  GenerateResult,
  MarketingStrategy,
  PlatformContent,
} from "./types";
import { scheduleDate } from "./dates";

export interface ExportSnapshot {
  url?: string;
  profile: ProductProfile | null;
  strategy?: MarketingStrategy | null;
  result: GenerateResult | null;
  launchDate?: string;
}

export function toJson(snap: ExportSnapshot): string {
  return JSON.stringify(snap, null, 2);
}

/** Render the whole CMO launch plan as portable Markdown. */
export function toMarkdown(snap: ExportSnapshot): string {
  const { profile, strategy, result, launchDate = "" } = snap;
  const out: string[] = [];
  out.push(`# ${profile?.name || "Launch"} — launch plan`, "");
  if (profile?.tagline) out.push(`> ${profile.tagline}`, "");

  if (strategy) appendStrategy(out, strategy);

  if (result?.schedule?.length) {
    out.push("## Launch calendar", "");
    for (const s of result.schedule) {
      const d = scheduleDate(launchDate, s.day);
      out.push(`- **Day ${s.day}${d ? ` · ${d}` : ""}** — ${s.action}`);
    }
    out.push("");
  }

  for (const c of result?.content || []) {
    out.push(`## ${c.platformName}`, "");
    const pb = c.playbook;
    if (pb) {
      if (pb.whyThisPlatform) out.push(`*Why this platform:* ${pb.whyThisPlatform}`);
      if (pb.howToPost) out.push(`*How to post:* ${pb.howToPost}`);
      if (pb.whatToAvoid) out.push(`*Avoid:* ${pb.whatToAvoid}`);
      if (pb.postingWindow) out.push(`*Post during:* ${pb.postingWindow}`);
      out.push("");
    }
    appendPosts(out, c);
    if (pb?.firstReplies?.length) {
      out.push("*First replies to seed discussion:*");
      pb.firstReplies.forEach((r) => out.push(`- ${r}`));
      out.push("");
    }
  }
  return out.join("\n");
}

/** Just the ready-to-post content, per platform — the copy-all-posts payload. */
export function postsToMarkdown(result: GenerateResult): string {
  const out: string[] = [];
  for (const c of result.content) {
    out.push(`## ${c.platformName}`, "");
    appendPosts(out, c);
  }
  return out.join("\n");
}

function appendPosts(out: string[], c: PlatformContent) {
  c.posts.forEach((post, i) => {
    if (c.posts.length > 1) out.push(`### Post ${i + 1}`, "");
    out.push(`**${post.hook}**`, "", post.body, "");
    if (post.imageSuggestion) out.push(`*Image:* ${post.imageSuggestion}`);
    if (post.bestTime) out.push(`*Best time:* ${post.bestTime}`);
    if (post.caveats) out.push(`*Caveat:* ${post.caveats}`);
    out.push("");
  });
}

/** Append the strategic CMO plan (everything that isn't per-platform content). */
function appendStrategy(out: string[], s: MarketingStrategy) {
  if (s.executiveSummary) out.push("## Executive summary", "", s.executiveSummary, "");
  if (s.positioning) out.push("## Positioning", "", s.positioning, "");
  if (s.antiPositioning) out.push(`**Don't position it as:** ${s.antiPositioning}`, "");
  if (s.overallStrategy) out.push("## The play", "", s.overallStrategy, "");
  if (s.coldStart) out.push(`**Cold start:** ${s.coldStart}`, "");

  if (s.audienceSegments?.length) {
    out.push("## Audience", "");
    for (const a of s.audienceSegments) {
      out.push(`- **${a.label}** (${a.tier}) — ${a.description}${a.whereTheyHang ? ` _Found in: ${a.whereTheyHang}_` : ""}`);
    }
    out.push("");
  }

  if (s.phases?.length) {
    out.push("## The plan, in phases", "");
    for (const p of s.phases) {
      out.push(`### ${p.window} — ${p.focus}`);
      p.actions.forEach((a) => out.push(`- ${a}`));
      out.push("");
    }
  }

  if (s.founderChecklist?.length) {
    out.push("## Founder checklist", "");
    for (const t of s.founderChecklist) out.push(`- **${t.when}** — ${t.task}`);
    out.push("");
  }

  if (s.risks?.length) {
    out.push("## Where this goes sideways", "");
    for (const r of s.risks) {
      out.push(`- **${r.area}** — ${r.risk} _Avoid it: ${r.mitigation}_`);
    }
    out.push("");
  }

  if (s.iterationLoop?.length) {
    out.push("## After you post: what to watch", "");
    for (const m of s.iterationLoop) {
      out.push(`- **${m.signal}** — ${m.read} _If weak: ${m.ifWeak}_`);
    }
    out.push("");
  }
}

/** Trigger a client-side file download. */
export function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
