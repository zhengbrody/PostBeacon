# M13 — Trust layer: facts, inference, and explainable recommendations

> Design + data-migration plan. Written before implementation; kept as the
> reference for how the trust system works. Status: implemented.

## Problem

PostBeacon's pipeline lets the model emit conclusions directly: profile fields
may be hallucinated on thin pages, the 0–100 platform score is an opaque model
number, "validated" affordances can attach to unverified claims, and one failed
platform call sinks a whole generation. The fix is structural: **separate what
was observed from what was inferred, compute scores in code from model-supplied
evidence, and make every claim carry its provenance.**

## 1. Fact Ledger

### Data model (lib/types.ts)

```ts
type FactStatus = "observed" | "user-confirmed" | "inferred" | "unknown";
type FactSourceType = "page" | "user" | "model" | "search";

interface Fact {
  id: string;              // stable within a project, e.g. "audience", "extra-1"
  field?: string;          // profile field this fact backs (name/audience/…)
  claim: string;           // the assertion, plain language ("" when unknown)
  evidence?: string;       // verbatim quote from the source page (observed only)
  sourceUrl?: string;      // where it was observed
  sourceType: FactSourceType;
  status: FactStatus;
  confidence: number;      // 0..1
  lastVerifiedAt: string;  // ISO — when evidence last verified / user confirmed
}
```

### Status semantics & enforcement

| status         | who can set it | requirement |
|----------------|----------------|-------------|
| observed       | code only      | evidence quote **verifies against the scraped page text** (normalized substring match). Model *proposes* observed; code demotes to inferred if the quote doesn't verify. |
| user-confirmed | user action only | server-side code never emits it; if a model emits it, it is demoted to inferred. |
| inferred       | model          | default for anything without verifying evidence. |
| unknown        | code           | empty claim, or the model says the page doesn't state it. |

The rule "模型不得把 inferred 写成 observed" is enforced mechanically in
`verifyFacts()` (lib/facts.ts), not by prompt trust: `observed` survives only
when its evidence quote is found in the page text the server itself scraped.
Everything else demotes. Confidence is clamped to [0,1] and capped at 0.6 for
demoted facts.

### Ledger contents

`/api/analyze` returns `facts[]` alongside the profile: one fact per key field
(name, tagline, valueProp, audience, category), one each for the three launch
context fields (stage, conversionGoal, assets — usually `unknown`), plus up to
3 extra notable claims (pricing, metrics, integrations). Cap: 14.

### User operations (profile step, FactLedger card)

- **Confirm** → status `user-confirmed`, confidence 1, lastVerifiedAt now.
- **Correct** → edit claim → `user-confirmed`, sourceType `user`; if the fact
  backs a profile field, the field syncs.
- **Delete** → removed from the ledger (and no longer fed to prompts).

### Downstream use

Strategy and generation prompts receive the ledger partitioned into
`ESTABLISHED FACTS (observed/user-confirmed)` vs `INFERRED (unverified)` vs
`UNKNOWN — do not assume`, with instructions to hedge or omit specifics not in
the established set.

## 2. Clarifying questions (max 3, no hallucinated fill)

After analyze, code — not the model — picks up to 3 questions from a fixed
high-value set, one per launch-context fact that is `unknown` or `inferred`
with confidence < 0.7:

1. **stage** — where the product is right now (pre-launch / just launched /
   growing).
2. **conversionGoal** — the single conversion that matters most right now.
3. **assets** — existing audience/assets/constraints (list, followers, budget).

The analyze prompt explicitly instructs: if the page doesn't state these,
return an empty claim (→ unknown). Answers become `user-confirmed` facts and
fill the new optional profile fields `stage` / `conversionGoal` / `assets`.
Skipping is allowed; skipped topics stay `unknown` and prompts are told not to
assume them.

## 3. Explainable weighted scoring

### Structure (per recommendation)

```ts
interface ScoreDimension { score: number /*0..10*/; reason: string; evidence?: string; factIds?: string[] }
interface ScoreBreakdown {
  audienceFit: ScoreDimension;      // model-rated
  intentFit: ScoreDimension;        // model-rated
  nativeContentFit: ScoreDimension; // model-rated
  founderAccess: ScoreDimension;    // model-rated
  effort: ScoreDimension;           // CODE-derived from the platform catalog
  risk: ScoreDimension;             // model-rated (10 = riskiest)
  evidenceQuality: ScoreDimension;  // CODE-derived (see below)
}
```

### Deterministic total (lib/scoring.ts)

The model never emits a total. Code computes:

```
value(dim)  = clamp(score, 0..10); effort & risk are inverted (10 - score)
total       = round( Σ weight_d × value_d × (100/10) )
WEIGHTS     = audienceFit .28 · intentFit .24 · nativeContentFit .18 ·
              founderAccess .10 · effort .08 · risk .07 · evidenceQuality .05
priority    = total ≥ 70 → high · ≥ 45 → medium · else low
```

- **effort** comes from the catalog's `effort` field (low=2, medium=5, high=8
  as cost; inverted for the total) — the model can't game it.
- **evidenceQuality** is computed from grounding: each model-rated dimension
  earns credit when it cites `factIds` that resolve to observed/user-confirmed
  facts (full credit) or inferred facts (half credit). 0–10.

### UI

StrategyView rows expand into a breakdown table: one bar + reason per
dimension, weight labels, and a provenance chip. The 0–100 number remains as
the headline but is now explainable.

## 4. Complete, unique, sourced 19 platforms

`normalizeRecommendations()` pipeline (lib/scoring.ts), applied to every model
response:

1. zod-validate each entry (per-dimension scores coerced/clamped; invalid
   entries dropped → treated as missing).
2. Dedupe by platformId (keep the richer entry), drop unknown ids.
3. Missing ids → **one retry call** scoped to just the missing platforms.
4. Still missing → deterministic **fallback entries** (neutral dimension
   scores, `fallback: true`, priority low, rationale says "not assessed —
   regenerate strategy for a real score"). The API therefore always returns
   exactly `PLATFORMS.length` (19) unique entries.

### Source discipline for venues/bestMove

The model outputs a `venue` (exact community name) per recommendation. Code
grounds it **post-hoc**: a recommendation gets `sources[]`/`provenance:
"grounded"` only when its venue/bestMove matches a *validated* discovered
channel (live search → URL-checked, from M3) — URLs are never taken from the
model. Otherwise `provenance: "inferred"`. The UI shows "✓ sourced" only for
grounded; inferred shows an "inferred" tag. Discovery itself already only marks
`validated` for grounded+reachable URLs; that invariant is unchanged.

## 5. Partial-success generation + output provenance

- `/api/generate` catches per-platform failures: response becomes
  `{ content, schedule, failures[], meta }` where `failures[i] =
  { platformId, platformName, error }`. Schedule entries are only created for
  platforms that produced content. All-platforms-failed → 502.
- ResultsView shows a failure panel; each failed channel has a **Retry** that
  calls `/api/regenerate` for that platform alone and splices the result in.
- Every generated output carries `meta: { provider, model, promptVersion,
  generatedAt }` (per-platform content meta + strategy-level meta).
  `PROMPT_VERSION` constants live next to the prompts (lib/generate.ts,
  lib/analysis.ts, lib/scoring.ts) and are bumped when prompts change.
  llm.ts gains `generateJsonMeta()` returning `{ data, provider, model }`.

## 6. Golden evaluation

- `tests/golden/fixtures/*.json` — 12 hand-written products across types
  (dev CLI, B2B SaaS, consumer mobile, AI writer, e-commerce, newsletter,
  OSS library, fintech, health, game, edtech, design tool). Each: synthetic
  scraped page + ground truth (claims that ARE on the page, claims that are
  NOT, whether stage/goal/assets are stated).
- **Offline suites (vitest, no network):** completeness & auto-repair
  (missing/dup/invalid → always 19 unique), fact-faithfulness enforcement
  (fabricated quote → demoted), banned-phrase linting (voice.ts exports the
  list programmatically), hallucinated-link grounding (model URLs never
  trusted), scoring determinism.
- **Live eval (`RUN_LIVE_EVAL=1 npx vitest run tests/eval.live.test.ts`):**
  runs analyze + strategy against real providers (deepseek: all fixtures;
  claude/openai: subset) and reports per provider: pre-repair completeness/
  duplicates/schema validity, observed-claim verification rate, fabricated-
  evidence rate, unknown-honesty (did it hallucinate stage/goal/assets),
  banned phrases in strategy prose, hallucinated venue URLs, latency. Writes
  `eval-results/report.md`. This is where provider quality differences are
  measured; it is deliberately not part of `npm test`.

## Data migration

No SQL migration. All new data rides existing jsonb columns:

| data | where it lives | old saves |
|---|---|---|
| facts | autosave payload: localStorage draft `facts` / Supabase `projects.meta.facts` | absent → ledger UI shows a "re-analyze to build the ledger" hint; prompts fall back to profile-only grounding |
| profile.stage/conversionGoal/assets | inside `projects.profile` jsonb (optional fields) | absent → questions simply reappear on next analyze |
| recommendation.breakdown/venue/sources/provenance/fallback | inside `projects.strategy` jsonb (optional) | absent → StrategyView renders the legacy single-score row |
| result.failures + content[].meta + strategy.meta | inside `projects.result`/`strategy` jsonb (optional) | absent → no failure panel, no meta line |

Rules: every new type field is optional in lib/types.ts; `loadProject()`
hydrates `facts ?? meta.facts ?? []`; validate.ts round-trip schemas accept the
new optional fields (bounded) so copilot/autosaved plans from BOTH generations
parse. The demo plan is hand-extended with facts + breakdowns so the no-key
showcase demonstrates the trust UI.

## Non-goals

- No persistence of facts outside the existing draft/project row.
- No re-verification cron for lastVerifiedAt (manual confirm updates it).
- Copilot keeps working plan-scoped; it sees fact statuses in its context but
  gets no new actions.
