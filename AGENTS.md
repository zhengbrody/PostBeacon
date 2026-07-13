# AGENTS.md — PostBeacon

> Living architecture + status doc. Keep this updated as the project evolves.

## What PostBeacon is
An AI-CMO SaaS for vibecoders. Paste a product URL → PostBeacon scrapes the page,
distills a product profile, scores all 19 catalog platforms for that
specific product, then generates **ready-to-post** native content + a launch calendar.
**No auto-posting** by design (copy-paste keeps users off platform ban radar).

- Brand: **PostBeacon**, domain **postbeacon.app** (owned). `postbeacon.com` was also
  free at selection time if a `.com` is wanted later. (Renamed from earlier "PostPilot",
  which collided with an existing marketing company.)

## Stack
Next.js 15 (App Router) · React 19 · Tailwind v4 · TypeScript (strict) · zod ·
Claude/OpenAI/DeepSeek (switchable) · Supabase (optional accounts) · cheerio + Firecrawl
(scraping) · vitest + ESLint (CLI, flat config) + Prettier + GitHub Actions CI. Deploys to Vercel.

## Data flow
```
URL ──► /api/analyze  ──► ProductProfile        (scrape + LLM extract)
        /api/strategy ──► MarketingStrategy      (score & rank ALL platforms + positioning)
        /api/generate ──► GenerateResult         (per-platform content + launch calendar)
```
The frontend drives this as a 4-step flow: input → profile → strategy → results
(plus /api/regenerate for single-channel rewrites and /api/copilot for the
plan-scoped CMO chat on the results dashboard).

## Architecture map
```
app/
  layout.tsx            Root layout, Inter font, metadata/OG
  globals.css           Tailwind v4 @theme design tokens (accent-*, surface, etc.)
  page.tsx              Marketing landing (composes components/landing/*)
  robots.ts             SEO (allow /, disallow /app)
  sitemap.ts            SEO sitemap (/) — makes robots.ts's reference real
  opengraph-image.tsx   Generated OG share card (next/og); twitter-image.tsx re-exports it
  icon.svg              Favicon (beacon mark, brand gradient)
  privacy|terms|subprocessors/page.tsx    Legal pages (draft pending review),
                        rendered from lib/privacy.ts via components/legal/LegalShell
  app/page.tsx          The tool — thin; wires useLaunchFlow to components/app/*
  api/
    analyze|strategy|generate|regenerate|providers|usage/route.ts   server endpoints
    account/{export,delete}/route.ts   data rights (bearer; delete = typed confirm +
                                       service role, fails closed 503 without it)
    retention/route.ts                 CRON_SECRET-gated retention sweep (vercel.json cron)
    copilot/route.ts                                                 Launch Copilot (plan-scoped CMO chat)
    billing/{checkout,webhook}/route.ts                              Polar checkout + webhook
lib/
  types.ts              All shared types (Provider, ProductProfile, MarketingStrategy, ...)
  platforms.ts          THE platform universe (catalog + per-platform voice rules). Most-tuned file.
  llm.ts                Claude/OpenAI/DeepSeek abstraction → generateJson() / generateJsonMeta()
  facts.ts              Fact Ledger engine: quote-verified statuses (observed/user-confirmed/
                        inferred/unknown), ≤3 clarifying-question picker, prompt partitioning
  analysis.ts           Analyze engine (profile + enforced facts + questions) — route & evals share it
  scoring.ts            Explainable scoring: model rates dimensions, CODE computes the 0-100 total,
                        19-platform completeness pipeline (retry→fallback), venue grounding
  generate.ts           Per-platform content prompt (generatePlatformPosts) — shared by generate+regenerate
  copilot.ts            Launch Copilot: plan+workspace+memory context builder, tool-based
                        {reply, actions} contract (runCopilot)
  copilotActions.ts     The action engine (M16): strict per-tool schemas, id/evidence
                        verification, destructive detection, impact lines, applyActionPlan
                        — the ONLY proposal→state bridge, used on explicit confirm
  voice.ts              ANTI_AI_RULES — house rules injected into content prompts to kill AI tells
  demo.ts               DEMO_PROJECT — hand-authored full example plan (the no-API-key showcase)
  site.ts               Public config (REPO_URL, FEEDBACK_URL) — NEXT_PUBLIC_* overridable
  privacy.ts            M17 single source for public privacy claims: data inventory,
                        subprocessor list, per-provider API-data notes + clear-policy
                        flag (orders the default), retentionDays — /privacy, /terms,
                        /subprocessors, the model picker and llm.ts all render it
  account.ts            Data rights: exportAccountData (RLS-scoped, no service role
                        needed) + deleteAccountData (child→parent table wipe, then
                        auth user removal; aborts before auth removal on failure)
  retention.ts          Operator retention sweep: stale projects (cascades workspace)
                        + old webhook ids past RETENTION_DAYS cutoff
  log.ts                logError/redact — the ONLY sanctioned console sink (eslint
                        no-console repo-wide); strips emails/query strings/tokens
  export.ts             Launch plan → Markdown / JSON; downloadFile helper
  dates.ts              scheduleDate(launchDate, day) for the calendar
  auth.ts               bearer(req) — read the Supabase token from a request
  usage.ts              Entitlement read/increment + FREE_LAUNCHES + daily cap (server metering)
  plan.ts               Shared plan shaping: rank ordering, canonical calendar entries (M14)
  today.ts              Workspace engine (M15): Today derivation (≤3 actions), 24h/72h
                        check-in due logic, rule-based verdicts, timeline, weekly review
  workspace.ts          Write-through sync to the campaigns/experiments/outcomes/tasks
                        tables (feature-detected, best-effort; meta.workspace hydrates)
  coerce.ts             unknown-typed coercers for loose JSON (replaces per-file any helpers, M14)
  async.ts              mapLimit — bounded-concurrency runner (route + evals share it, M14)
  errors.ts             PublicError/BlockedUrlError + ApiErrorBody/ApiErrorCode — THE error
                        shape every route returns and the client consumes
  urlPolicy.ts          SSRF URL policy (schemes/ports/hostnames/IPv4+IPv6 ranges); isomorphic,
                        also guards external <a href>s (isSafeExternalHref)
  safeFetch.ts          SSRF-safe fetch for user/model URLs: DNS validated at connect time
                        (anti-rebinding), per-hop redirect revalidation, size/type/time caps
  validate.ts           zod schemas for every API body + readJsonBody size cap + apiError
  billing.ts            Polar webhook verify (signature+timestamp) / event evaluation / idempotency
  fetch.ts              fetchWithTimeout — OPERATOR-configured endpoints only (never user URLs)
  scrape.ts             Landing-page fetch + extract (static → render fallback), via safeFetch
  render.ts             Headless render seam for SPA pages (Firecrawl; SCRAPE_API_KEY)
  search.ts             Live web search seam (Tavily; SEARCH_API_KEY) for grounding
  discovery.ts          Niche-channel discovery: search→ground→URL-validate, LLM fallback
  api.ts                Browser→server typed client (used by the hook)
  storage.ts            Versioned localStorage draft (DRAFT_SCHEMA_VERSION + migrateDraft;
                        the Supabase projects.meta jsonb carries the same version)
  supabase/client.ts    Browser Supabase client (graceful if unconfigured)
  supabase/server.ts    Service-role client (server-only; trust-counts usage)
hooks/
  launchFlowReducer.ts  THE plan state machine: pure reducer + normalize() enforcing the
                        invariants (no result without its strategy, selection ⊆ channels,
                        posted marks ⊆ existing posts, step never deeper than the data)
  useLaunchFlow.ts      Thin hook over the reducer: async API actions + ephemeral UI state
  useAutosave.ts        Debounced persist: localStorage (anon) / Supabase upsert (signed-in)
components/
  ui/                   Button, Card, Badge, Spinner, Field, Tabs (design system primitives)
  app/                  Stepper, UrlStep, ProfileForm, FactLedger (provenance UI + questions),
                        LaunchSetup (M15 intake: date + weekly budget),
                        StrategyView (score breakdowns), ResultsView (workspace orchestrator:
                        Today default + Full plan/Timeline/Review),
                        PlanSummary, CopilotPanel, ProjectBar, SignIn, AuthScreen, Paywall,
                        UsageBadge, FeedbackCTA
  app/results/          Workspace surfaces (M15): TodayTab, PublishDialog, OutcomePanel,
                        TimelineTab, ReviewTab — plus the full report (PlanReport wrapping
                        the M14 per-tab modules: OverviewTab, ContentTab + ChannelBlock +
                        PostCard, CalendarTab, ExecuteTab, FailuresCard, PrintHeading)
  landing/              Nav, Hero, HowItWorks, PlatformShowcase, Pricing, FAQ, Footer
  legal/                LegalShell — shared frame for the three legal pages
docs/M13-trust-layer.md Design + migration doc for the trust layer (facts/scoring/partial success)
docs/M15-workspace.md   PRD + state diagram + acceptance criteria for the launch workspace
docs/M16-copilot-actions.md  Design contract for the copilot action engine
docs/M17-privacy-trust.md    Data-flow map, inventory, threat model, counsel questions
tests/                  vitest suites: urlPolicy, safeFetch, billing, webhook route, validate,
                        golden (12-fixture offline evals), generateRoute, flowReducer
                        (state-machine invariants), storage (draft migrations), workspace
                        (Today/verdicts/review), copilotActions (action boundary, injection,
                        destructive gates, memory), account (deletion coverage vs schema,
                        export), retention, log (redaction), privacy (source consistency,
                        provider ordering); eval.live (gated)
tests/golden/           fixtures.ts — 12 product-type golden fixtures with ground truth
supabase/schema.sql     projects + entitlements + webhook_events + M15 campaigns/
                        experiments/outcomes/tasks tables (owner-only RLS)
.github/workflows/ci.yml  typecheck · lint · format:check · offline tests · build on every push/PR
eslint.config.mjs / .prettierrc.json   non-interactive lint + format (next lint is deprecated)
```

## Security posture
- **SSRF**: every URL that originates from a user, a model, or search results is fetched
  ONLY through `lib/safeFetch.ts` (scrape static fetch, discovery liveness probes) after
  `lib/urlPolicy.ts` validation (http/https only, standard ports, credentials rejected,
  localhost/private/loopback/link-local/multicast/CGNAT/cloud-metadata/reserved IPv4 ranges
  blocked, IPv6 allowlisted to global unicast 2000::/3 minus doc/6to4/Teredo). DNS results
  are validated inside the socket's own lookup (any blocked A/AAAA record rejects — no
  rebinding TOCTOU), redirects are never auto-followed (each hop re-validated, capped),
  responses are size/content-type/time capped. Firecrawl input URLs pass the same policy
  before leaving the box. Operator-configured endpoints (SCRAPE/SEARCH/POLAR API URLs) use
  `lib/fetch.ts` and may point at private infra. External hrefs in the UI render only for
  `isSafeExternalHref` (absolute http/https) URLs.
- **Input validation**: every POST body is parsed with `lib/validate.ts` (zod) — bounded
  strings/arrays, deduped + catalog-checked platformIds, provider/action allowlists,
  history capped, 1MB raw-body cap (webhook 256KB). No `as`-assertion trust anywhere.
- **Error/log hygiene**: routes return only `PublicError` messages (validation, scrape
  status, provider-config); everything else collapses to a generic line. Validation errors
  name the field but never echo the submitted value. Nothing (input, tokens, prompts,
  keys) is logged server-side.
- **Polar**: webhook fails closed (503) without `POLAR_WEBHOOK_SECRET`; verifies Standard
  Webhooks HMAC + timestamp (±300s), dedupes by webhook-id in `webhook_events`, and only
  acts on allowlisted event types whose product id matches `POLAR_PRODUCT_ID` and whose
  user id is a UUID. Checkout `success_url` comes from the `SITE_URL` allowlist — the
  Origin header is honored only when it's in that list.
- **Headers**: global CSP + nosniff/DENY/referrer/permissions/HSTS in `next.config.mjs`
  (dev adds `unsafe-eval` + the Vercel Analytics debug script host).
- **Known accepted**: `npm audit` reports a moderate advisory on Next's internally pinned
  postcss (build-time only; every Next release is flagged — revisit on the next Next major).

## Conventions
- TS strict. Components are presentational; state/effects live in `hooks/` or route handlers.
- Brand color = `accent-*` tokens only (defined in `globals.css`), never raw `violet-*`.
- Reuse `components/ui/*` primitives; don't re-style buttons/cards inline.
- No dead code. Self-review each change for duplication and consistency before moving on.
- Plan state changes go through hooks/launchFlowReducer.ts actions — never parallel useState
  that can drift. Loose JSON is normalized with lib/coerce.ts, not `any`. Rank ordering and
  calendar entries come from lib/plan.ts (one source, three consumers).
- LLM calls go through `lib/llm.ts`; browser calls through `lib/api.ts`.

## Run
```bash
npm install
cp .env.example .env     # ANTHROPIC_API_KEY and/or OPENAI_API_KEY (Supabase keys optional)
npm run dev              # landing at /, tool at /app
npm run typecheck        # tsc --noEmit
npm test                 # vitest (offline suites in tests/; no API keys needed)
npm run lint             # eslint . (flat config, non-interactive)
npm run format:check     # prettier --check . (CI-enforced)
npm run build            # must stay green
RUN_LIVE_EVAL=1 npx vitest run tests/eval.live.test.ts   # live provider eval → eval-results/
```

## Deploy (Vercel)
Import repo → set env (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`) → point `postbeacon.app` DNS at Vercel. Accounts need
`supabase/schema.sql` run once in the Supabase SQL editor.

Optional env (each degrades gracefully if unset): `SCRAPE_API_KEY` (Firecrawl, SPA scraping),
`SEARCH_API_KEY` (Tavily, grounded discovery), `SITE_URL` (comma-separated allowlist for the
post-checkout redirect; defaults to https://postbeacon.app), and for metering/billing
`SUPABASE_SERVICE_ROLE_KEY` + `POLAR_ACCESS_TOKEN` + `POLAR_PRODUCT_ID` + `POLAR_WEBHOOK_SECRET`
(point the Polar webhook at `/api/billing/webhook`; without the secret the webhook fails closed).

**Live (2026-06-24):** Vercel project `zhengbrodys-projects/postbeacon` → **https://postbeacon.app** + www.
Porkbun DNS: apex `A 76.76.21.21`, www `CNAME cname.vercel-dns.com` (nameservers stay on Porkbun).
Set in Vercel: ANTHROPIC/OPENAI/DEEPSEEK keys + `DEFAULT_PROVIDER=deepseek`. Supabase & billing
left unset → accounts off (anon + localStorage), generation open/unmetered, `Pricing` hidden (beta).
Redeploy: `npx vercel --prod --yes`. Push env from `.env.local`: `~/push-env.sh`.

## Status / changelog
- **2026-07-12**: **M17 — Privacy & trust foundation** (engineering + draft copy for
  LEGAL REVIEW, not legal advice; full data-flow map, per-category inventory
  (purpose/legal-basis suggestion/retention/region/deletion/subprocessors), threat
  model, and 10 open counsel questions in docs/M17-privacy-trust.md). (1) Single
  source lib/privacy.ts (inventory, subprocessor list, per-provider API-data notes,
  retentionDays) renders /privacy, /terms, /subprocessors (components/legal/
  LegalShell, marked "beta draft — under legal review", footer/sitemap-linked), the
  model-picker notes, AND the provider ordering — public claims can't drift from
  code. (2) Contextual notices: URL step ("page fetched server-side + sent to
  {model}; draft stays in this browser"), sign-in consent lines (AuthScreen +
  compact SignIn), copilot feedback-paste warning (amber for unclear-policy
  providers), footer "No auto-posting, no training on your content". (3) FAQ fixed:
  "Bring your own API key" removed (untrue — keys are server env), localStorage
  persistence stated honestly, DeepSeek listed, "profile+feedback go to the selected
  provider" stated. (4) Provider policy posture: PROVIDER_PRIVACY marks DeepSeek
  clearPolicy:false (China processing, training not clearly excluded) → never the
  code default (availableProviders orders clear-policy first; DEFAULT_PROVIDER env
  stays an explicit operator override and the UI still shows the caution).
  (5) Data rights: "Discard draft" now truly clears localStorage; GET
  /api/account/export (bearer, RLS-scoped user client — works without service role)
  downloads projects/campaigns/experiments/outcomes/tasks/entitlement as JSON; POST
  /api/account/delete (typed-phrase zod confirm) wipes all six user tables
  child→parent then auth.admin.deleteUser — FAILS CLOSED 503 without service role;
  delete-project × is confirm-gated (FKs cascade the workspace); ProjectBar "Data &
  privacy" menu (export / type-DELETE account deletion / privacy link).
  (6) Retention: /api/retention (503 without CRON_SECRET, 401 wrong bearer,
  {enabled:false} until RETENTION_DAYS set) sweeps stale projects + webhook ids;
  vercel.json daily cron; /privacy renders the same env so policy self-updates.
  (7) No cross-user training/aggregation by default — stated in Privacy+Terms with
  the future opt-in contract (separate, explicit, revocable, de-identified, minimum
  cohort). (8) Log hygiene: repo had zero console.* calls; now locked by eslint
  no-console (app/components/hooks/lib) with lib/log.ts logError/redact (emails,
  query strings, Bearer/JWT/sk- tokens, newline collapse, 300-char cap) as the only
  sink, used by the new routes. 28 new tests (257 total): schema-coverage proof that
  every table is wiped-or-documented, FK-safe delete order + abort-before-auth-user,
  export completeness incl. meta-carried memory, retention gates/cutoff/sweep,
  redaction, provider ordering + privacy-source consistency. Verified in browser:
  all 3 pages render (incl. dynamic retention copy), FAQ/footer fixed, auth-screen
  consent line, DeepSeek amber warning on feedback paste; curl: export/delete 401
  unauthenticated, retention 503 unconfigured. Known limits for counsel: contact is
  the GitHub feedback link (needs a real privacy email), governing law + liability
  placeholders, provider-policy summaries need re-verification, production
  DEFAULT_PROVIDER=deepseek flagged for decision.
- **2026-07-12**: **M16 — Copilot as an auditable CMO action engine** (design contract first:
  docs/M16-copilot-actions.md; still ZERO auto-posting — no posting tool exists in the
  schema). (1) Nine structured tools (ask_clarifying_question, propose_next_actions,
  update_positioning, update_channel_priority, create_experiment, generate_variant,
  record_outcome, diagnose_outcome, stop_or_continue_channel); the model returns
  {reply, actions} and NEVER mutates state — lib/copilotActions.ts is the hard boundary
  (strict per-tool zod, unknown tools dropped, platform/experiment ids checked against real
  objects, ≤5 actions/reply; record_outcome has no metric fields so numbers can't be
  fabricated into state). (2) UI: every proposal is an ActionCard with diff (old→new),
  rationale, verified-evidence chips, plain-language impact line, Apply/Dismiss; stop /
  priority-downgrade / overwriting hand-edited fields arm a second confirmation
  (userEditedFields tracked via origin-tagged reducer patches). (3) Evidence is
  recomputed server-side: refs that don't resolve are dropped+counted; confidence
  grounded/unknown is code-derived; unknown → the model must say so and attach a
  validationExperiment. (4) Product Memory (draft v5 + meta.memory, lean by construction):
  tone, banned claims, auto-appended winning/losing angles (citing experiments),
  accepted/rejected rewrite summaries, userEditedFields — chat transcripts are never
  stored; facts/outcomes referenced from their existing sources, not duplicated.
  (5) Proactive briefing on panel open — deterministic (lib/today.buildBriefing): today's
  actions+budget, due 24h/72h collections, weekly loops + best angle, next-experiment chip;
  zero model calls, zero latency. (6) Audit log (workspace.auditLog, cap 100):
  applied/rejected/blocked per proposal with destructive flag + evidence verified/cited;
  Audit view in the panel. (7) Injection defenses: pasted text delimited «» and declared
  data, validator refuses minted verbs/fabricated ids, human confirm is the only
  state bridge. 24 new tests (schema boundary, metric smuggling, evidence re-verification,
  destructive detection, apply mapping purity, memory transitions, v5 migration, prompt
  contract). Verified live in the browser (deepseek): briefing, grounded action cards with
  evidence chips (experiment/memory/post/fact refs), destructive two-step (state provably
  unchanged until confirm), prefilled publish dialog with cancel ⇒ no experiment, audit
  entries persisted. 229 offline tests, all gates green.
- **2026-07-12**: **M15 — Launch Workspace: from one-shot report to a continuing loop**
  (PRD + state diagram + acceptance criteria written first: docs/M15-workspace.md; still
  ZERO auto-posting). (1) Intake: Diagnose step now asks goal/stage/assets (M13 questions)
  + launch date + weekly time budget (new LaunchSetup card; all skippable). (2) Post-
  generation home is **Today** — ≤3 derived action cards (why-now, est minutes, linked
  drafts, done/skip) with a weekly-budget line; the full report moved intact under
  "Full plan" (Today · Full plan · Timeline · Review nav, progressive disclosure).
  (3) Marking published opens a prefilled dialog → creates an **experiment**
  {platform, community, angle, variant, publishedAt, trackedUrl, hypothesis}. (4) 24h/72h
  check-ins surface on Today (+nav badge): impressions/replies/clicks/signups/revenue/
  qualitative paste — manual only, absent ≠ 0. (5) Saving outcomes returns the read
  IMMEDIATELY, computed in code (supported/promising/weak/no-signal + the rule that
  fired + continue/stop advice + ≤3 next actions) and offers one-click follow-up
  variant (the only LLM call in the loop, via the existing copilot rewrite) or stop.
  (6) Timeline (event projection) + Weekly Review with the **north star: weekly
  completed learning loops** (published→outcomes→verdict), channel scoreboard, ≤3
  next-week suggestions. (7) Persistence: draft v4 (workspace migration + tests),
  projects.meta.workspace (signed-in, zero SQL), and normalized campaigns/experiments/
  outcomes/tasks tables with owner-only RLS (schema.sql, additive) written through
  best-effort with feature detection (lib/workspace.ts). Engine (lib/today.ts) is pure
  and unit-tested (20 tests); full loop verified in the browser: seeded 30h-old
  experiment → Today badge + record card → outcomes → "hypothesis supported" verdict →
  publish dialog (prefilled r/selfhosted) → Timeline/Review update → v4 draft survives
  reload. 207 offline tests, all gates green.
- **2026-07-12**: **M14 — behavior-preserving engineering cleanup.** (1) ResultsView (865
  lines) split into `components/app/results/` — one module per tab + ChannelBlock/PostCard/
  FailuresCard/PrintHeading; ResultsView is now a ~200-line orchestrator. (2) Plan state moved
  from 16 parallel useStates into `hooks/launchFlowReducer.ts` — a pure reducer whose
  normalize() makes contradictory states impossible (fresh analyze / rebuilt strategy now
  drop stale downstream data; selection ⊆ channels; posted marks pruned with their posts;
  step clamped to available data; loading a real project after the demo clears the demo flag
  — the last four were live bug classes). 12 invariant tests. (3) Unified `ApiErrorBody`/
  `ApiErrorCode` in lib/errors.ts consumed by routes and lib/api.ts; deduped mapLimit
  (lib/async), rank-order + calendar-entry logic (lib/plan ×3 copies each), and the
  `str/arr` any-typed coercers (lib/coerce, 5 files); app-code `any` went 38 → 3 (the
  documented JSON seam in lib/llm.ts). (4) Persisted plans are versioned:
  DRAFT_SCHEMA_VERSION=3 + migrateDraft() (v1 pre-M11 / v2 M11 / v3 M13) with tests;
  Supabase meta rows carry the same version. (5) Tooling: deprecated interactive `next lint`
  replaced by ESLint CLI (flat config), Prettier + format:check (repo formatted once),
  GitHub Actions CI (typecheck/lint/format/tests/build). (6) Fixed the /twitter-image build
  warning (`runtime` segment config can't be re-exported — declared literally). Deleted:
  platformCatalogForStrategist (dead since M13), 15 needless exports de-exported;
  components/landing/Pricing.tsx is intentionally KEPT (documented beta gating). Gates green
  throughout: 185 offline tests, eslint/prettier clean, build warning-free; demo dashboard +
  step navigation re-verified in the browser.
- **2026-07-12**: **M13 — trust layer.** Facts, inference and recommendations separated; design +
  migration doc in `docs/M13-trust-layer.md` (no SQL migration — new data rides existing jsonb;
  all new type fields optional so pre-M13 saves keep rendering). Fact Ledger with code-enforced
  provenance (observed requires a machine-verified page quote; model can't emit user-confirmed;
  unknown discards guesses) + user confirm/correct/delete; ≤3 code-picked clarifying questions
  (stage/conversionGoal/assets) instead of hallucinated fill; explainable platform scoring
  (model rates 5 dimensions with reasons+factIds; effort from catalog, evidenceQuality computed,
  0-100 total & priority deterministic in code) with breakdown UI; guaranteed 19 unique
  recommendations via validate→dedupe→scoped-retry→flagged-fallbacks, venue "grounded" only from
  validated live discoveries; generation is partial-success (failures listed + per-channel retry)
  and every output stamped with provider/model/promptVersion/generatedAt. 12 golden fixtures +
  offline eval suites + gated live eval (`RUN_LIVE_EVAL=1`, writes eval-results/). Live numbers
  (2026-07-12): deepseek 9% fabricated-evidence (caught), 96% unknown-honesty, 114/114 first-pass
  scoring completeness, 92% drafts banned-phrase-free; gpt-4o 58% fabricated-evidence (all
  caught), 37% fact-citing recs; claude 401 = invalid local API key (env, not code). Gates green
  (typecheck / 168 tests / lint / build); UI verified in browser incl. a real analyze round-trip.
- **2026-07-11**: **M12 — P0 security hardening** (no product changes). (1) **SSRF**: new
  `lib/urlPolicy.ts` + `lib/safeFetch.ts` shared by scrape, discovery URL checks, and
  Firecrawl input; DNS validated at connect time (anti-rebinding), redirects re-validated
  per hop, size/type/timeout caps; discovery drops non-public URLs; StrategyView links only
  safe hrefs. (2) **Runtime validation**: `lib/validate.ts` (zod) replaces every `as`-cast
  request body across analyze/strategy/generate/regenerate/copilot — bounded fields, deduped
  + catalog-checked platformIds, provider/action allowlists, 1MB body cap; new
  `lib/errors.ts` PublicError keeps internal error detail out of responses. (3) **Polar**:
  webhook fails closed without secret, verifies timestamp (±300s) + HMAC, dedupes by
  webhook-id (`webhook_events` table in schema.sql), acts only on allowlisted event types
  matching `POLAR_PRODUCT_ID` with UUID user ids; checkout success_url now uses the
  `SITE_URL` allowlist instead of trusting Origin. (4) **Headers**: global CSP + security
  headers in next.config.mjs. (5) **Tooling**: vitest (133 tests: urlPolicy/safeFetch/
  billing/webhook-route/validate), eslint (next/core-web-vitals), `typecheck`+`test`
  scripts. typecheck/test/lint/build green; SSRF rejections, schema 400s, webhook 503,
  body-cap 413, headers, and the happy path (live analyze incl. real redirects) verified
  against a running dev server. See "Security posture" above.
- **2026-07-02**: M11 — editable, focused, navigable. Default selection = top-4 channels by
  score; `selected` persisted (draft field / projects.meta); ResultsView rebuilt as 4 tabs
  (Overview/Content/Calendar/Execute, components/ui/Tabs) with master-detail content and
  print force-mount; plan editing everywhere (positioning, per-channel angle/bestMove,
  calendar row edit/delete/add, channels removable + addable post-generation via
  /api/regenerate).
- **2026-07-01**: M10 — Contextual Launch Copilot. lib/copilot.ts (compact plan snapshot,
  7 actions incl. rewrite/first-replies/review-feedback, anti-generic rules) + POST
  /api/copilot + components/app/CopilotPanel.tsx drawer (quick actions, per-reply copy,
  rewrite cards with Apply-to-draft). Prompt hardening in voice/generate/strategy/analyze;
  "Copy all posts"; 20+→19 platform-count fix.
- **2026-06-25**: M9 — login gate + Google OAuth. /app requires sign-in when Supabase is
  configured (open otherwise; ?demo=1 always bypasses); AuthScreen with
  Continue-with-Google + magic link; AppPage (gate) / AppFlow (tool) split.
- **2026-06-25**: M8 — beta-launch polish. lib/demo.ts hand-authored example plan +
  ?demo=1 deep link; FeedbackCTA + lib/site.ts; lib/llm.ts JSON slice/repair + one model
  repair retry; founder-voice README + MIT LICENSE.
- **2026-06-24**: M7 — AI-CMO operating system. analyze forms a business diagnosis
  (whatItIs/whyCare/useCase/confidence); strategy becomes the full CMO plan (executive
  summary, positioning/anti-positioning, audience segments, cold start + GTM phases,
  founder checklist, risks, iteration loop, effort/confidence/bestMove per channel);
  generate emits per-platform playbooks; lib/voice.ts ANTI_AI_RULES + per-platform
  personas; results becomes the sectioned operating dashboard (PlanSummary.tsx).
- **2026-06-24**: **DEPLOYED to production** — live at https://postbeacon.app (+ www) on Vercel.
  Beta posture: no Supabase / service-role / Polar configured → fully open & free, no payment UI.
- **2026-06-24**: All platform `blurb`s translated to English (they surface in the launch-calendar
  action text). App is now fully English — no CJK in `app/`, `components/`, `lib/`, `hooks/`.
- **2026-06**: MVP flow (analyze→strategy→generate) + platform universe (20+) +
  Supabase skeleton + phase-2 discovery stub.
- **2026-06**: Rebrand LaunchLoop→PostBeacon. Restructured monolithic page into
  `hooks/useLaunchFlow` + `lib/api` + `components/{ui,app,landing}`. Added design
  tokens, marketing landing page, product-grade app UI, robots.ts. Build green; UI
  verified in browser.
- **2026-06**: Added **DeepSeek** provider (OpenAI-compatible: base URL
  `api.deepseek.com`, model `deepseek-chat`) in `lib/llm.ts`. Added optional
  `DEFAULT_PROVIDER` env to pin the UI's first-selected model. Verified the full
  pipeline (analyze→strategy→generate) end-to-end against `mindmarket.app` with a
  live DeepSeek key — content + calendar generate correctly.

- **2026-06**: M1 — SPA scraping fallback. `lib/scrape.ts` refactored to a single
  `extract()` path with empty-shell detection; when a static fetch comes back blank
  (client-rendered SPA) and `SCRAPE_API_KEY` is set, it renders via new `lib/render.ts`
  (Firecrawl seam, swappable) and re-extracts. `ScrapedPage.rendered` added. Graceful
  degradation to static when unconfigured. Build green.

- **2026-06**: M2 — content + launch polish. (2a) `/api/generate` now blends the
  product's own `tone` with platform voice. (3c) Generated OG/Twitter share card via
  `next/og` (`app/opengraph-image.tsx` + re-exporting `twitter-image.tsx`), `app/icon.svg`
  favicon, real `app/sitemap.ts`. Extracted one magic-link auth impl into
  `components/app/SignIn.tsx` (+ `useSupabaseUser` hook); `ProjectBar` now consumes it and
  it's surfaced in the landing `Nav`. Build green.

- **2026-06**: M6 — monetization. Server-enforced metering: new `lib/supabase/server.ts`
  (service-role), `lib/usage.ts` (entitlements: free = 3 launches), `lib/auth.ts` (`bearer`).
  `/api/generate` now requires sign-in + checks/increments usage **server-side** (was open);
  `/api/regenerate` requires sign-in; `/api/usage` reports remaining. Polar (merchant-of-record)
  `/api/billing/checkout` + signed `/api/billing/webhook` (flips plan → pro). UI: `Paywall`
  (401 sign-in / 402 upgrade), `UsageBadge`, landing `Pricing`. All gating is no-op unless
  `SUPABASE_SERVICE_ROLE_KEY` is set, so the keyless app still runs open. New `entitlements`
  table in `supabase/schema.sql`. Build green. NOTE: confirm Polar webhook event shapes against
  live events when wiring the Polar account.
- **2026-06**: Beta gating — landing `Pricing` and the nav link are hidden (component kept;
  re-add `<Pricing />` in `app/page.tsx` to monetize). With no `SUPABASE_SERVICE_ROLE_KEY`,
  metering is off, so generation is fully open and no payment UI ever shows. Beta = everything free.
- **2026-06**: M5 — autosave & retention. New `hooks/useAutosave.ts` debounce-persists the
  flow: anonymous → a single `lib/storage.ts` localStorage draft; signed-in → **upsert** one
  `projects` row by a stable `projectId` (replaces the old insert-a-new-row Save). `useLaunchFlow`
  hydrates a draft on mount and tracks `projectId`; on sign-in the draft migrates to the account
  and the local copy clears. `ProjectBar` now shows autosave status + "Save now". (`updated_at`
  is set explicitly on upsert since the table has no trigger.) Build green.
- **2026-06**: M4 — content depth & editability. Extracted the per-platform prompt into
  `lib/generate.ts` (`generatePlatformPosts`), reused by `/api/generate` and the new
  `/api/regenerate`. Added: A/B `hookVariants` (selectable chips), inline post editing
  (`updatePost` + `<Field>`), per-channel Regenerate, full-draft long-form (medium/ph-blog/
  youtube gain `longForm`+`maxTokens`), real calendar dates from a launch-day picker
  (`lib/dates.ts`), and Markdown/JSON/Print export (`lib/export.ts` + `@media print`).
  `launchDate` is ephemeral for now (persisted in M5). Build green.
- **2026-06**: M3 — grounded discovery. New `lib/search.ts` (Tavily seam, `SEARCH_API_KEY`).
  `lib/discovery.ts` now searches the live web, has the model SELECT from REAL results
  (no invented URLs), and URL-validates; grounded hits are `validated:true`. Falls back to
  LLM-only (validated only if reachable) with no key. `DiscoveredChannel.validated` added;
  `StrategyView` shows a "✓ link checked" affordance. Build green.

## Roadmap
- Chinese platform universe (小红书/即刻/V2EX/掘金/B站).
- Effect tracking (post analytics).
