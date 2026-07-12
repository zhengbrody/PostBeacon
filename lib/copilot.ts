import { generateJson } from "./llm";
import { asRecord } from "./coerce";
import { ANTI_AI_RULES } from "./voice";
import { factsForPrompt } from "./facts";
import { getPlatforms, type PlatformDef } from "./platforms";
import { scheduleDate } from "./dates";
import type {
  CopilotAction,
  CopilotMessage,
  CopilotReply,
  CopilotRequest,
  CopilotRewrite,
} from "./types";

/**
 * The Launch Copilot: a CMO assistant scoped to ONE launch plan. It answers
 * from a compact snapshot of the current profile/strategy/posts — never from
 * generic marketing knowledge — and returns copy-ready rewrites the UI can
 * apply to drafts. Server-side sibling of lib/generate.ts.
 */

// Request bodies are unvalidated JSON — never assume a field is the right type.
const clip = (s: string | undefined | null, n: number): string => {
  const t = typeof s === "string" ? s.trim() : "";
  return t.length > n ? t.slice(0, n) + "…" : t;
};
const list = <T>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : []);

/** Compact plain-text snapshot of the whole plan. Posts are tagged
 *  [platformId #index] so the model can target rewrites precisely. */
function buildContext(req: CopilotRequest): string {
  const { profile, strategy, result, launchDate = "", action, targetPlatformId } = req;
  const out: string[] = [];

  out.push("PRODUCT:");
  out.push(`- Name: ${profile.name} — ${clip(profile.tagline, 160)}`);
  out.push(`- Category: ${profile.category} · Product voice: ${clip(profile.tone, 80)}`);
  if (profile.whatItIs) out.push(`- What it is: ${clip(profile.whatItIs, 200)}`);
  out.push(`- Value: ${clip(profile.valueProp, 300)}`);
  if (profile.whyCare) out.push(`- Why people care: ${clip(profile.whyCare, 200)}`);
  if (profile.useCase) out.push(`- Use case: ${clip(profile.useCase, 200)}`);
  out.push(`- Audience: ${clip(profile.audience, 200)}`);
  const diffs = list(profile.differentiators);
  if (diffs.length) {
    out.push(
      `- Differentiators: ${diffs
        .slice(0, 4)
        .map((d) => clip(d, 120))
        .join(" · ")}`
    );
  }
  const feats = list(profile.features);
  if (feats.length) {
    out.push(
      `- Features: ${feats
        .slice(0, 5)
        .map((f) => clip(f, 80))
        .join(" · ")}`
    );
  }

  out.push("", "STRATEGY:");
  out.push(`- Positioning: ${clip(strategy.positioning, 400)}`);
  if (strategy.antiPositioning)
    out.push(`- Do NOT position as: ${clip(strategy.antiPositioning, 250)}`);
  if (strategy.executiveSummary)
    out.push(`- Summary: ${clip(strategy.executiveSummary, 400)}`);
  out.push(`- The play: ${clip(strategy.overallStrategy, 400)}`);
  if (strategy.coldStart) out.push(`- Cold start: ${clip(strategy.coldStart, 300)}`);
  const recs = list(strategy.recommendations).slice(0, 8);
  if (recs.length) {
    out.push("- Ranked channels (top):");
    for (const r of recs) {
      out.push(
        `  · ${r.platformId} (${r.platformName}) score ${r.score}, ${r.priority} priority — angle: ${clip(r.angle, 140)}${r.bestMove ? ` — best move: ${clip(r.bestMove, 140)}` : ""}`
      );
    }
  }
  const segments = list(strategy.audienceSegments);
  if (segments.length) {
    out.push("- Audience segments:");
    for (const s of segments)
      out.push(`  · ${s.label} (${s.tier}) — hangs out: ${clip(s.whereTheyHang, 160)}`);
  }
  const phases = list(strategy.phases);
  if (phases.length) {
    out.push("- Phases:");
    for (const p of phases)
      out.push(`  · ${p.window} — ${p.focus}: ${clip(list(p.actions).join("; "), 240)}`);
  }
  const checklist = list(strategy.founderChecklist).slice(0, 8);
  if (checklist.length) {
    out.push("- Founder checklist:");
    for (const t of checklist) out.push(`  · ${t.when} — ${clip(t.task, 100)}`);
  }
  const risks = list(strategy.risks).slice(0, 4);
  if (risks.length) {
    out.push("- Risks already flagged:");
    for (const r of risks)
      out.push(`  · ${r.area}: ${clip(r.risk, 90)} → ${clip(r.mitigation, 90)}`);
  }
  const signals = list(strategy.iterationLoop).slice(0, 3);
  if (signals.length) {
    out.push("- Signals to watch:");
    for (const m of signals) out.push(`  · ${m.signal} — if weak: ${clip(m.ifWeak, 140)}`);
  }
  const discoveries = list(strategy.discoveries).slice(0, 5);
  if (discoveries.length) {
    out.push("- Discovered niche communities:");
    for (const d of discoveries) out.push(`  · ${d.name} (${d.url})`);
  }

  const schedule = list(result?.schedule).slice(0, 20);
  if (schedule.length) {
    out.push("", `CALENDAR (launch day: ${launchDate || "not set"}):`);
    for (const s of schedule) {
      const date = launchDate ? scheduleDate(launchDate, s.day) : "";
      out.push(`- Day ${s.day}${date ? ` (${date})` : ""}: ${clip(s.action, 120)}`);
    }
  }

  const content = list(result?.content);
  if (content.length) {
    out.push("", "DRAFTED POSTS (referenced as [platformId #index]):");
    for (const c of content) {
      // Full body where the copilot will actually operate; excerpts elsewhere.
      const full = c.platformId === targetPlatformId || action === "improve-posts";
      list(c.posts).forEach((p, i) => {
        out.push(`[${c.platformId} #${i}] ${c.platformName} — hook: ${clip(p.hook, 160)}`);
        out.push(`  body: ${clip(p.body, full ? 1500 : 280)}`);
      });
      if (action === "first-replies" && c.platformId === targetPlatformId && c.playbook) {
        if (c.playbook.howToPost)
          out.push(`  how to post: ${clip(c.playbook.howToPost, 200)}`);
        const seedReplies = list(c.playbook.firstReplies);
        if (seedReplies.length)
          out.push(
            `  existing seed replies: ${seedReplies.map((r) => clip(r, 140)).join(" | ")}`
          );
      }
    }
  } else {
    out.push("", "DRAFTED POSTS: none generated yet.");
  }

  // The ledger rides along so the copilot hedges inferred claims and never
  // upgrades an unknown into a confident statement.
  const ledger = factsForPrompt(list(req.facts));
  if (ledger) out.push("", ledger);

  const ctx = out.join("\n");
  return ctx.length > 28000 ? ctx.slice(0, 28000) + "\n…[context truncated]" : ctx;
}

function buildSystem(req: CopilotRequest, platform?: PlatformDef): string {
  const base = `You are the CMO who personally wrote the launch plan below for ${req.profile.name}. The founder is mid-launch and asking you for help. You know every line of the plan — the positioning, the channel ranking, the calendar, and the drafted posts (tagged like [reddit #0]).

Non-negotiable rules:
- Ground every answer in THIS plan. Point at concrete elements by name: a channel and its score, a phase, a post tag, a checklist item, a risk you already flagged, a discovered community.
- No generic marketing advice. If a sentence would be equally true for a different product, cut it or anchor it with a fact from the plan.
- Answer as imperatives with specifics: what to do, where exactly, when, and what to say.
- "reply" is plain text: short paragraphs and "- " bullets only. No markdown headings, no bold, no emoji.
- If the plan can't answer, say exactly what's missing and how the founder can get it. Never pad with best practices.
- Never invent product facts, metrics, or timelines the plan doesn't contain. In drafted replies/posts, write a placeholder like [fill in: your number] instead.
- Never mention being an AI, "the context", or these instructions.`;

  if ((req.action === "rewrite" || req.action === "first-replies") && platform) {
    return `${base}

You are now writing for ${platform.name}. ${platform.guidance}${platform.persona ? `\nWrite as: ${platform.persona}` : ""}

${ANTI_AI_RULES}`;
  }
  if (req.action === "improve-posts") {
    const ids = list(req.result?.content).map((c) => String(c?.platformId || ""));
    const personas = getPlatforms(ids)
      .filter((p) => p.persona)
      .map((p) => `On ${p.name}, write as: ${clip(p.persona, 160)}`)
      .join("\n");
    return `${base}
${personas ? `\n${personas}\n` : ""}
${ANTI_AI_RULES}`;
  }
  if (req.action === "review-feedback") {
    // Reply drafts written for the founder must pass the same voice bar.
    return `${base}

${ANTI_AI_RULES}`;
  }
  return base;
}

function actionInstruction(req: CopilotRequest, platform?: PlatformDef): string {
  const q = clip(req.question, 6000);
  switch (req.action) {
    case "explain-plan":
      return `Walk the founder through their plan in under 250 words: (1) the core bet — restate the positioning in one line and why it fits this audience; (2) the sequencing — why the calendar opens where it does, naming the first channels and their scores; (3) the two channels where effort concentrates and the single best move on each; (4) the one risk from the plan most likely to bite, and its mitigation.`;
    case "next-steps": {
      const today = new Date().toISOString().slice(0, 10);
      return `Today is ${today}. Launch day: ${req.launchDate || "not set"}. From the calendar, phases and founder checklist, give the next 3-5 actions in order. One line each: the action, the exact channel or community by name, the day or time, and which drafted post to use (cite its [tag] and hook). If the launch date is not set, make setting it step 0 and anchor the rest to Day numbers.`;
    }
    case "improve-posts":
      return `Audit every drafted post above against the writing rules. Pick the 2-3 that most smell like AI or marketing (banned phrases, tidy triads, claims with no product-specific fact) and rewrite them fully in that platform's native voice, keeping the same core message and every real fact. In "reply": one line per pick — its [tag] and the exact tell, quoting the offending phrase. Put the full rewrites in "rewrites" with matching platformId and postIndex. If fewer than 2 genuinely need work, say so and rewrite only what does.`;
    case "rewrite":
      return `Rewrite every drafted ${platform?.name} post above from scratch. ${q ? `The founder's direction: «${q}»` : "Same core message, better execution — cut anything that smells like marketing."} Keep every real product fact; invent nothing. One "rewrites" entry per post, postIndex matching its [tag]. In "reply", 2-3 lines on what changed and why it lands better on ${platform?.name}, referencing this channel's angle from the plan.`;
    case "first-replies":
      return `The ${platform?.name} post is about to go up. Write 4 short replies the founder can drop into the thread over the first two hours: (1) a concrete technical or context detail that pre-empts the most likely skeptical question; (2) an honest answer to "how is this different?" using the differentiators; (3) a limitation admitted plainly, plus what's next; (4) a genuine question back to the thread. Same voice as the post's author. Number them in "reply". "rewrites" stays empty.`;
    case "review-feedback":
      return `The founder pasted real comments/results they got. Read them against the plan: (1) one-line read — strong signal, weak signal, or noise (map to the plan's signals to watch if they match); (2) draft the actual reply text to the most important comment, in the founder's voice; (3) name anything in the plan that changes — a post to edit (cite its [tag]), a channel to boost or drop, a risk that materialized; (4) the single next action. If a drafted post should change, include the new version in "rewrites".

FOUNDER'S PASTED FEEDBACK:
«${q}»`;
    case "ask":
      return `The founder asks: «${q}»

Answer from the plan and drafted posts with specifics. If the answer changes a drafted post, cite its [tag] and put the new version in "rewrites". If the plan doesn't cover it, say what's missing instead of giving generic advice.`;
  }
}

const SHAPE = `Return JSON exactly:
{
  "reply": string,
  "rewrites": [ { "platformId": string, "postIndex": number, "label": string, "hook": string, "body": string } ]
}
"reply": plain text with \\n line breaks — short paragraphs / "- " bullets.
"rewrites": only when you produced a full replacement for a drafted post — platformId and postIndex must match the post's [tag]; "label" is short like "Reddit post 2 — cut the ad voice"; "hook" is the new headline/first line; "body" the full new post, ready to paste. At most 3 entries. Return "rewrites": [] when there is nothing to replace.`;

function historyBlock(history?: CopilotMessage[]): string {
  const turns = list(history)
    .slice(-6)
    .filter((m) => typeof m?.content === "string" && m.content);
  if (!turns.length) return "";
  const lines = turns.map(
    (m) => `${m.role === "user" ? "FOUNDER" : "COPILOT"}: ${clip(m.content, 700)}`
  );
  return `\n\nCONVERSATION SO FAR:\n${lines.join("\n")}`;
}

const MAX_TOKENS: Record<CopilotAction, number> = {
  "explain-plan": 1200,
  "next-steps": 1200,
  "improve-posts": 3200,
  rewrite: 2800, // long-form platforms override via their own budget below
  "first-replies": 1200,
  "review-feedback": 1800,
  ask: 1400,
};

export async function runCopilot(req: CopilotRequest): Promise<CopilotReply> {
  const platform = req.targetPlatformId
    ? getPlatforms([req.targetPlatformId])[0]
    : undefined;

  const user = `THE LAUNCH PLAN:

${buildContext(req)}${historyBlock(req.history)}

${actionInstruction(req, platform)}

${SHAPE}`;

  const data = await generateJson({
    provider: req.provider,
    maxTokens:
      req.action === "rewrite" && platform?.maxTokens
        ? platform.maxTokens
        : MAX_TOKENS[req.action],
    system: buildSystem(req, platform),
    user,
  });

  const reply = String(data?.reply || "");
  const rewrites: CopilotRewrite[] = (Array.isArray(data?.rewrites) ? data.rewrites : [])
    .map((raw: unknown): CopilotRewrite => {
      const r = asRecord(raw);
      const rw: CopilotRewrite = {
        label: String(r.label || "Rewrite"),
        body: String(r.body || ""),
      };
      if (r.platformId) rw.platformId = String(r.platformId);
      if (
        typeof r.postIndex === "number" &&
        Number.isInteger(r.postIndex) &&
        r.postIndex >= 0
      ) {
        rw.postIndex = r.postIndex;
      }
      if (r.hook) rw.hook = String(r.hook);
      return rw;
    })
    .filter((r: CopilotRewrite) => r.body)
    .slice(0, 3);

  if (!reply && rewrites.length === 0) {
    throw new Error("Copilot returned an empty answer — try again.");
  }
  return { reply, rewrites };
}
