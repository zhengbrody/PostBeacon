import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, type GoldenFixture } from "./golden/fixtures";
import { mapLimit } from "@/lib/async";

/**
 * LIVE golden evaluation — calls real providers. Deliberately NOT part of
 * `npm test`; run it with:
 *
 *   RUN_LIVE_EVAL=1 npx vitest run tests/eval.live.test.ts
 *
 * deepseek runs the full fixture set; claude/openai run subsets (cost).
 * Writes eval-results/report.{md,json}. The only hard assertions are the
 * structural guarantees (19 unique platforms, enforced fact statuses) —
 * everything else is measured and reported, not gated.
 */

const LIVE = !!process.env.RUN_LIVE_EVAL;

// Load .env.local the way Next would (values never logged).
if (LIVE) {
  try {
    const env = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // no .env.local — rely on the ambient environment
  }
}

// Imported dynamically so env from .env.local is in place first (llm.ts reads
// keys at call time, but keep the ordering obvious anyway).
const lib = async () => ({
  analysis: await import("@/lib/analysis"),
  scoring: await import("@/lib/scoring"),
  generate: await import("@/lib/generate"),
  llm: await import("@/lib/llm"),
  voice: await import("@/lib/voice"),
  platforms: await import("@/lib/platforms"),
  safety: await import("@/lib/contentSafety"),
});

type Provider = "deepseek" | "claude" | "openai";

/** Per-provider workload (fixture counts tuned for cost/latency; deepseek is
 *  the production default so it gets the widest coverage). */
const PLAN: Record<Provider, { analyze: number; scoring: number; content: number }> = {
  deepseek: { analyze: 12, scoring: 6, content: 6 },
  claude: { analyze: 4, scoring: 3, content: 2 },
  openai: { analyze: 4, scoring: 3, content: 4 },
};

interface AnalyzeRow {
  fixture: string;
  ok: boolean;
  nameCorrect: boolean;
  observedFinal: number;
  proposedObserved: number;
  demotedObserved: number; // fabricated evidence caught by enforcement
  unknownWithClaim: number;
  contextHonest: number; // unstated context fields left unknown (0..n)
  contextUnstated: number;
  questions: number;
  ms: number;
  error?: string;
}

interface ScoringRow {
  fixture: string;
  ok: boolean;
  firstPassValid: number;
  duplicates: number;
  invalid: number;
  retried: number;
  recovered: number;
  fallbacks: number;
  citingFacts: number; // recs citing ≥1 ledger fact
  venues: number; // recs naming a venue
  grounded: number;
  modelUrls: number; // URLs the model wrote into prose (never rendered as links)
  ms: number;
  error?: string;
}

interface ContentRow {
  fixture: string;
  platform: string;
  ok: boolean;
  posts: number;
  bannedHits: number;
  bannedPhrases: string[];
  foreignUrls: number; // URLs pointing anywhere but the product's own domain
  // M22 generation-quality metrics: the M20/M21 truth gate applied to live output.
  unsafeDrafts: number; // drafts the gate would block as generated
  safetyIssueCodes: string[]; // unique issue codes across this channel's drafts
  limitedPosts: number; // posts on a charLimit platform
  singleFitDrafts: number; // fit one post outright
  threadOnlyDrafts: number; // exceed the single limit but every segment fits
  unpostableDrafts: number; // a segment exceeds the platform limit (over-limit gate)
  ms: number;
  error?: string;
}

function errLabel(e: unknown): string {
  const status = (e as { status?: unknown })?.status;
  if (typeof status === "number") return `HTTP ${status}`;
  return e instanceof Error ? e.name : "error";
}

const URL_RE = /https?:\/\/[^\s"')\]]+/g;

function foreignUrlCount(text: string, ownHost: string): number {
  return (text.match(URL_RE) ?? []).filter((u) => {
    try {
      return !new URL(u).hostname.endsWith(ownHost);
    } catch {
      return true;
    }
  }).length;
}

describe.runIf(LIVE)("live golden eval", () => {
  const results: Record<
    string,
    { analyze: AnalyzeRow[]; scoring: ScoringRow[]; content: ContentRow[] }
  > = {};

  it(
    "runs the fixture suite against every configured provider",
    { timeout: 1_800_000 },
    async () => {
      const { analysis, scoring, generate, llm, voice, platforms, safety } = await lib();
      const wanted = (process.env.EVAL_PROVIDERS || "deepseek,claude,openai")
        .split(",")
        .map((s) => s.trim()) as Provider[];
      const provs = wanted.filter((p) => llm.availableProviders().includes(p));
      expect(provs.length, "no provider keys configured").toBeGreaterThan(0);

      // Providers hit different API endpoints — run them in parallel.
      const runProvider = async (provider: Provider) => {
        const plan = PLAN[provider];
        const aRows: AnalyzeRow[] = [];
        const sRows: ScoringRow[] = [];
        const cRows: ContentRow[] = [];
        results[provider] = { analyze: aRows, scoring: sRows, content: cRows };

        // ---- analyze ----
        const aFixtures = FIXTURES.slice(0, plan.analyze);
        const analyses = await mapLimit(aFixtures, 4, async (f) => {
          const t0 = Date.now();
          try {
            const out = await analysis.analyzeScrapedPage(f.page, provider);
            const ctx: (keyof GoldenFixture["truth"]["states"])[] = [
              "stage",
              "conversionGoal",
              "assets",
            ];
            const unstated = ctx.filter((k) => !f.truth.states[k]);
            const honest = unstated.filter(
              (k) => out.facts.find((x) => x.field === k)?.status === "unknown"
            );
            // Hard guarantee: enforced ledger can never contain a
            // user-confirmed fact or an observed fact without verified evidence.
            for (const fact of out.facts) {
              expect(fact.status).not.toBe("user-confirmed");
              if (fact.status === "observed") {
                expect(fact.evidence && fact.evidence.length >= 8).toBeTruthy();
              }
            }
            expect(out.questions.length).toBeLessThanOrEqual(3);
            aRows.push({
              fixture: f.id,
              ok: true,
              nameCorrect:
                out.profile.name.toLowerCase().includes(f.truth.name.toLowerCase()) ||
                f.truth.name.toLowerCase().includes(out.profile.name.toLowerCase()),
              observedFinal: out.facts.filter((x) => x.status === "observed").length,
              proposedObserved: out.audit.proposedObserved,
              demotedObserved: out.audit.demotedObserved,
              unknownWithClaim: out.audit.unknownWithClaim,
              contextHonest: honest.length,
              contextUnstated: unstated.length,
              questions: out.questions.length,
              ms: Date.now() - t0,
            });
            return out;
          } catch (e) {
            aRows.push({
              fixture: f.id,
              ok: false,
              nameCorrect: false,
              observedFinal: 0,
              proposedObserved: 0,
              demotedObserved: 0,
              unknownWithClaim: 0,
              contextHonest: 0,
              contextUnstated: 0,
              questions: 0,
              ms: Date.now() - t0,
              error: errLabel(e),
            });
            return null;
          }
        });

        // ---- scoring ----
        const sFixtures = FIXTURES.slice(0, plan.scoring);
        await mapLimit(sFixtures, 3, async (f) => {
          const idx = FIXTURES.indexOf(f);
          const a = analyses[idx];
          if (!a) return;
          const t0 = Date.now();
          try {
            const { recommendations, diagnostics } = await scoring.scoreAllPlatforms(
              a.profile,
              a.facts,
              (prompt) => llm.generateJson({ provider, ...prompt })
            );
            // The structural guarantee under test: complete + unique, always.
            expect(recommendations).toHaveLength(platforms.PLATFORMS.length);
            expect(new Set(recommendations.map((r) => r.platformId)).size).toBe(
              platforms.PLATFORMS.length
            );
            const prose = (r: (typeof recommendations)[number]) =>
              [r.rationale, r.angle, r.bestMove ?? "", r.venue ?? ""].join(" ");
            sRows.push({
              fixture: f.id,
              ok: true,
              firstPassValid: diagnostics.firstPassValid,
              duplicates: diagnostics.duplicates,
              invalid: diagnostics.invalid,
              retried: diagnostics.retried.length,
              recovered: diagnostics.recovered.length,
              fallbacks: diagnostics.fallbacks.length,
              citingFacts: recommendations.filter((r) =>
                Object.values(r.breakdown ?? {}).some((d) => d.factIds?.length)
              ).length,
              venues: recommendations.filter((r) => r.venue).length,
              grounded: recommendations.filter((r) => r.provenance === "grounded").length,
              modelUrls: recommendations.reduce(
                (n, r) => n + (prose(r).match(URL_RE)?.length ?? 0),
                0
              ),
              ms: Date.now() - t0,
            });
          } catch (e) {
            sRows.push({
              fixture: f.id,
              ok: false,
              firstPassValid: 0,
              duplicates: 0,
              invalid: 0,
              retried: 0,
              recovered: 0,
              fallbacks: 0,
              citingFacts: 0,
              venues: 0,
              grounded: 0,
              modelUrls: 0,
              ms: Date.now() - t0,
              error: errLabel(e),
            });
          }
        });

        // ---- content (top platform pair per fixture) ----
        const cFixtures = FIXTURES.slice(0, plan.content);
        const pairs = cFixtures.flatMap((f) => {
          const idx = FIXTURES.indexOf(f);
          const a = analyses[idx];
          if (!a) return [];
          return [
            { f, a, platform: "hackernews" },
            { f, a, platform: "twitter" },
          ];
        });
        await mapLimit(pairs, 4, async ({ f, a, platform }) => {
          const t0 = Date.now();
          const def = platforms.PLATFORMS.find((p) => p.id === platform)!;
          try {
            const { posts } = await generate.generatePlatformPosts(
              a.profile,
              def,
              provider,
              a.facts
            );
            const own = new URL(f.page.url).hostname;
            let banned = 0;
            const phrases: string[] = [];
            let foreign = 0;
            let unsafe = 0;
            const codes = new Set<string>();
            const limit = safety.platformCharLimit(platform);
            let singleFit = 0;
            let threadOnly = 0;
            let unpostable = 0;
            for (const post of posts) {
              const text = [post.hook, ...(post.hookVariants ?? []), post.body].join("\n");
              const hits = voice.lintVoice(text);
              banned += hits.length;
              phrases.push(...hits.map((h) => h.phrase));
              foreign += foreignUrlCount(text, own);
              const report = safety.auditDraftSafety(post, a.facts, a.profile, platform);
              if (!report.ready) unsafe += 1;
              for (const issue of report.issues) codes.add(issue.code);
              if (limit) {
                const budget = safety.charBudget(post, limit);
                if (budget.fitsSingle) singleFit += 1;
                else if (budget.fitsThread) threadOnly += 1;
                else unpostable += 1;
              }
            }
            cRows.push({
              fixture: f.id,
              platform,
              ok: posts.length > 0 && posts.every((p) => p.hook && p.body),
              posts: posts.length,
              bannedHits: banned,
              bannedPhrases: [...new Set(phrases)],
              foreignUrls: foreign,
              unsafeDrafts: unsafe,
              safetyIssueCodes: [...codes],
              limitedPosts: limit ? posts.length : 0,
              singleFitDrafts: singleFit,
              threadOnlyDrafts: threadOnly,
              unpostableDrafts: unpostable,
              ms: Date.now() - t0,
            });
          } catch (e) {
            cRows.push({
              fixture: f.id,
              platform,
              ok: false,
              posts: 0,
              bannedHits: 0,
              bannedPhrases: [],
              foreignUrls: 0,
              unsafeDrafts: 0,
              safetyIssueCodes: [],
              limitedPosts: 0,
              singleFitDrafts: 0,
              threadOnlyDrafts: 0,
              unpostableDrafts: 0,
              ms: Date.now() - t0,
              error: errLabel(e),
            });
          }
        });
      };

      await Promise.all(provs.map(runProvider));
      writeReport(results);
    }
  );
});

// A placeholder so the file reports as skipped (not empty) without the flag.
describe.runIf(!LIVE)("live golden eval (skipped)", () => {
  it.skip("set RUN_LIVE_EVAL=1 to run against real providers", () => {});
});

// ---------------------------------------------------------------------------

function pct(n: number, d: number): string {
  return d === 0 ? "–" : `${Math.round((n / d) * 100)}%`;
}
function avg(xs: number[]): number {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
}

function writeReport(
  results: Record<
    string,
    { analyze: AnalyzeRow[]; scoring: ScoringRow[]; content: ContentRow[] }
  >
) {
  const lines: string[] = [
    "# Live golden eval report",
    "",
    `Run: ${new Date().toISOString()} · fixtures: ${FIXTURES.length} product types`,
    ...(process.env.SEARCH_API_KEY
      ? []
      : [
          "",
          "> Note: SEARCH_API_KEY is unset in this environment, so live discovery",
          "> returns no validated channels and venue grounding is expected to be 0",
          "> here (the grounding mechanism itself is covered by the offline suite).",
        ]),
    "",
  ];

  for (const [provider, r] of Object.entries(results)) {
    const a = r.analyze;
    const s = r.scoring;
    const c = r.content;
    const aOk = a.filter((x) => x.ok);
    lines.push(`## ${provider}`, "");
    const failures = [
      ...a.filter((x) => !x.ok).map((x) => `analyze ${x.fixture}: ${x.error}`),
      ...s.filter((x) => !x.ok).map((x) => `scoring ${x.fixture}: ${x.error}`),
      ...c
        .filter((x) => !x.ok)
        .map((x) => `content ${x.fixture}/${x.platform}: ${x.error}`),
    ];
    if (failures.length) lines.push(`Failures: ${failures.join(" · ")}`, "");
    lines.push(
      `### Analyze (${a.length} fixtures, ${aOk.length} ok, avg ${avg(aOk.map((x) => x.ms))}ms)`,
      "",
      `- name correct: ${pct(aOk.filter((x) => x.nameCorrect).length, aOk.length)}`,
      `- observed facts kept per fixture (post-enforcement): ${avg(aOk.map((x) => x.observedFinal))}`,
      `- fabricated-evidence rate (proposed observed → demoted): ${pct(
        aOk.reduce((n, x) => n + x.demotedObserved, 0),
        aOk.reduce((n, x) => n + x.proposedObserved, 0)
      )} (${aOk.reduce((n, x) => n + x.demotedObserved, 0)}/${aOk.reduce(
        (n, x) => n + x.proposedObserved,
        0
      )})`,
      `- unknown honesty (unstated context left unknown): ${pct(
        aOk.reduce((n, x) => n + x.contextHonest, 0),
        aOk.reduce((n, x) => n + x.contextUnstated, 0)
      )}`,
      `- guesses stuffed into unknowns (discarded by code): ${aOk.reduce(
        (n, x) => n + x.unknownWithClaim,
        0
      )}`,
      `- questions asked: avg ${avg(aOk.map((x) => x.questions))} (cap 3)`,
      ""
    );

    const sOk = s.filter((x) => x.ok);
    const totalPlatforms = 19;
    lines.push(
      `### Scoring (${s.length} fixtures, ${sOk.length} ok, avg ${avg(sOk.map((x) => x.ms))}ms)`,
      "",
      `- first-pass completeness: ${pct(
        sOk.reduce((n, x) => n + x.firstPassValid, 0),
        sOk.length * totalPlatforms
      )} (${sOk.reduce((n, x) => n + x.firstPassValid, 0)}/${sOk.length * totalPlatforms})`,
      `- duplicates emitted: ${sOk.reduce((n, x) => n + x.duplicates, 0)} · schema-invalid entries: ${sOk.reduce((n, x) => n + x.invalid, 0)}`,
      `- retry recovered: ${sOk.reduce((n, x) => n + x.recovered, 0)}/${sOk.reduce((n, x) => n + x.retried, 0)} · fallbacks used: ${sOk.reduce((n, x) => n + x.fallbacks, 0)}`,
      `- POST-REPAIR completeness: 100% by construction (asserted: 19 unique every run)`,
      `- recs citing ledger facts: ${pct(
        sOk.reduce((n, x) => n + x.citingFacts, 0),
        sOk.length * totalPlatforms
      )} · naming a venue: ${pct(
        sOk.reduce((n, x) => n + x.venues, 0),
        sOk.length * totalPlatforms
      )}`,
      `- grounded venues (validated-discovery matches): ${sOk.reduce((n, x) => n + x.grounded, 0)} · model-written URLs in prose: ${sOk.reduce((n, x) => n + x.modelUrls, 0)} (never rendered as links)`,
      ""
    );

    const cOk = c.filter((x) => x.ok);
    const allPhrases = [...new Set(c.flatMap((x) => x.bannedPhrases))];
    lines.push(
      `### Content (${c.length} platform drafts, ${cOk.length} ok, avg ${avg(cOk.map((x) => x.ms))}ms)`,
      "",
      `- drafts with zero banned phrases: ${pct(
        c.filter((x) => x.ok && x.bannedHits === 0).length,
        cOk.length
      )} · total banned hits: ${c.reduce((n, x) => n + x.bannedHits, 0)}${
        allPhrases.length ? ` (${allPhrases.join(", ")})` : ""
      }`,
      `- drafts containing non-product URLs: ${c.filter((x) => x.foreignUrls > 0).length}`,
      `- truth-gate clean as generated: ${pct(
        cOk.reduce((n, x) => n + (x.posts - x.unsafeDrafts), 0),
        cOk.reduce((n, x) => n + x.posts, 0)
      )} · issue codes seen: ${
        [...new Set(cOk.flatMap((x) => x.safetyIssueCodes))].join(", ") || "none"
      }`,
      `- char contract on limited platforms (${cOk.reduce(
        (n, x) => n + x.limitedPosts,
        0
      )} posts): single-fit ${cOk.reduce((n, x) => n + x.singleFitDrafts, 0)} · thread-only ${cOk.reduce(
        (n, x) => n + x.threadOnlyDrafts,
        0
      )} · UNPOSTABLE ${cOk.reduce((n, x) => n + x.unpostableDrafts, 0)}`,
      ""
    );
  }

  const dir = path.join(__dirname, "..", "eval-results");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "report.md"), lines.join("\n"));
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(results, null, 2));

  console.log("\n" + lines.join("\n"));
}
