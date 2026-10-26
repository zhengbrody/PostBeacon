# AGENTS.md — PostBeacon

> Living architecture + status doc. Keep this updated as the project evolves.

## What PostBeacon is
An AI-CMO SaaS for vibecoders. Paste a product URL → PostBeacon scrapes the page,
distills a product profile, scores all 19 catalog platforms for that
specific product, then generates **ready-to-post** native content + a launch calendar.
The plan opens into an action-first growth workspace: one next best move → manual publish →
24h/72h result → verdict → next experiment. Launch mode becomes Growth mode after the first
measured publish; weekly completed learning loops are the retention north star.
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
guest URL ──► /api/preview ──► one safe channel + one truth-checked draft
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
  privacy|terms|subprocessors/page.tsx    Private-beta behavior/data notices (no paid,
                        entity, jurisdiction or liability placeholders), rendered from
                        lib/privacy.ts via components/legal/LegalShell
  app/page.tsx          The tool — thin; wires useLaunchFlow to components/app/*
  api/
    analyze|strategy|generate|regenerate|providers|usage/route.ts   server endpoints
    preview/route.ts           signed-out one-channel first value; persistent atomic quota
    account/{export,delete}/route.ts   data rights (bearer; delete = typed confirm +
                                       service role, fails closed 503 without it)
    retention|reminders/route.ts       CRON_SECRET-gated daily operator jobs; reminders
                                       are explicit opt-in and fail closed without Resend
    metrics/route.ts                   CRON_SECRET-gated aggregate funnel/weekly-retention
                                       report; no identities, content, or outcome values
    copilot/route.ts                                                 Launch Copilot (plan-scoped CMO chat)
    opportunities/route.ts      C.1 signed-in, explicit-source trial research; one model
                                 request, no automatic fallback or autonomous publishing
    agent-runs/route.ts         C.2.0 flag-gated persistent research tasks; owner-scoped
                                 reads, atomic reservations and request-backed fenced worker
    agent-missions/{route,tick/route}.ts C.3 standing public-research authorization and
                                 bounded operator dispatch; separately gated, not enabled
    billing/{checkout,webhook}/route.ts                              Polar checkout + webhook
lib/
  types.ts              All shared types (Provider, ProductProfile, MarketingStrategy, ...)
  platforms.ts          THE platform universe (catalog + per-platform voice rules). Most-tuned file.
  llm.ts                Claude/OpenAI/DeepSeek abstraction → generateJson() / generateJsonMeta();
                        retryable failures fail over to eligible providers with actual-provider
                        provenance; DeepSeek requires the disclosed public beta opt-in
  facts.ts              Fact Ledger engine: quote-verified statuses (observed/user-confirmed/
                        inferred/unknown), ≤3 clarifying-question picker, prompt partitioning
  contentSafety.ts      M20 deterministic last-mile truth gate: placeholders, impersonation,
                        invented identity/story/testimonial, unsupported metrics/limitations,
                        and high-risk outcome promises; blocks copy/publish until repaired
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
  guestPreview.ts       Minimal scrape→analyze→rank→one draft orchestration; same Truth Gate
  guestPreviewConfig.ts Fail-closed feature/provider/privacy/limit configuration
  guestPreviewQuota.ts  Atomic per-visitor + global Upstash quota (no submitted content)
  guestPreviewToken.ts  Signed random visitor identity + keyed quota digest (no IP/fingerprint)
  previewHandoff.ts     1h browser-only guest result + 30m one-time auth nonce handoff;
                        explicit account continuation, consumed only by matching callback
  productAnalytics.ts  Allowlisted cookieless funnel events; drops content/identity fields
  productMetrics.ts    Pure aggregate funnel + two-window weekly-retention engine and
                       paginated, content-free normalized-table reader
  sourceCoverage.ts    M25.0 server-authored Analyze receipt, persisted-JSON normalizer
                       and deterministic submitted-extract coverage labels
  site.ts               Public config (feedback + monitored privacy contact) —
                        NEXT_PUBLIC_* overridable with safe fallbacks
  privacy.ts            M17 single source for public privacy claims: data inventory,
                        subprocessor list, per-provider API-data notes + clear-policy
                        flag (orders the default), configured-vendor/billing visibility,
                        retentionDays — public pages, the model picker and llm.ts render it
  account.ts            Data rights: exportAccountData (RLS-scoped, no service role
                        needed) + deleteAccountData (transactional DB RPC, then auth
                        user removal; explicit fallback for pre-migration installs)
  accountBoundary.ts    Pure account-switch rule: user A → sign-out/user B clears
                        in-memory/local draft state before the next identity sees it
  retention.ts          Operator retention sweep: stale projects (cascades workspace)
                        + old webhook ids past RETENTION_DAYS cutoff
  reminders.ts          M18 opt-in 24h/72h/weekly event emails: pure due derivation,
                        Resend delivery + provider idempotency, tasks-table delivery ledger
  log.ts                logError/redact — the ONLY sanctioned console sink (eslint
                        no-console repo-wide); strips emails/query strings/tokens
  export.ts             Launch plan → Markdown / JSON; downloadFile helper
  dates.ts              scheduleDate(launchDate, day) for the calendar
  auth.ts               bearer(req) — read the Supabase token from a request
  usage.ts              Entitlement read/increment + FREE_LAUNCHES + daily cap (server metering)
  plan.ts               Shared plan shaping: rank ordering, canonical calendar entries (M14)
  today.ts              Workspace engine (M15): Today derivation (≤3 actions), 24h/72h
                        check-in due logic, one primary move + collapsed alternatives,
                        rule-based verdicts, first-value path, timeline, weekly review
  growth.ts             M18 Launch/Growth mode boundary + stage-aware primary-goal helper
  successContract.ts    M25.1 bounded success definition, persisted-data normalizer,
                        visible summaries and checkpoint/signal helpers
  strategyDecision.ts   M25.2 deterministic one-experiment ranking, honest comparison,
                        effort and observable-signal projection
  experimentContract.ts M25.3 pure Prepare/Publish contract, draft provenance and bounded
                        X/LinkedIn share-kit projections from canonical plan state
  experimentQueue.ts    M26 A/B bounded planned-test normalization and deterministic
                        comparison boundary; changed held conditions become exploratory
  learningEvidence.ts   M26 A/B Outcome-referenced, final-window angle evidence and
                        observed 72h-minus-24h deltas; unknown/invalid tests excluded
  opportunityResearch.ts C.1/C.2.2 bounded receipts, explicit product-led/evidence-led modes,
                         verified facts and reviewed-context trial provenance; not AgentRun jobs
  trialBrief.ts          Editable three-question CMO Brief suggestions, not feature evidence
  trialDraftSafety.ts    Actual platform/post-index trial exit checks shared by Today/library
  opportunityResearchServer.ts Explicit source-only safe fetch and single-request provider
                              orchestration; quote verification is not demand/rules review
  agentRuns.ts                Owner-visible job receipts, bounded status projection; no fake progress
  agentRunServer.ts           Saved-context/owner check, reserve/transition RPC seam and
                              at-most-one-model worker; not an always-on scheduler
  agentMissions.ts / agentMissionServer.ts C.3 owner/revision/expiry authorization,
                              shared-budget daily reservation and bounded dispatch
  autonomousResearch.ts / autonomousResearchServer.ts Approved exact-host public search,
                              independent quote checks and one existing OpenAI attempt
  execution.ts          M19 Prepare→Publish→Measure→Learn lifecycle projection,
                        countdowns and operator-controlled platform destinations
  publishHandoff.ts     C.2.1 pure Truth-Gate checked, user-initiated X single-post
                        composer shortcut; complete manual fallback, never publication
  experimentHistory.ts M24.1 Outcome-owned verdict reads, honest legacy-final fallback
                        and v7 workspace compatibility repair
  experimentIdentity.ts M24.1 draft/execution/checkpoint task identity helpers
  trackedUrl.ts         M24.1 absolute HTTP(S)-only live-post navigation/persistence seam
  projectIdentity.ts    Same-name saved-project labels (product + hostname + updated date)
  workspace.ts          Write-through sync to the campaigns/experiments/outcomes/tasks
                        tables (feature-detected, best-effort; meta.workspace hydrates)
  coerce.ts             unknown-typed coercers for loose JSON (replaces per-file any helpers, M14)
  async.ts              mapLimit — bounded-concurrency runner (route + evals share it, M14)
  asyncScope.ts         Ephemeral stale-request/abort boundary and owner/project keyed
                        ordered client writes; not a persistent Agent job system
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
  projectSaveError.ts   Bounded Supabase/PostgREST project-save error copy
  storage.ts            Versioned localStorage draft (DRAFT_SCHEMA_VERSION + migrateDraft;
                        v12 adds explicit product-led mode, fact IDs and reviewed-context snapshots;
                        projects.meta carries the authoritative workspace)
  supabase/client.ts    Browser Supabase client (graceful if unconfigured)
  supabase/server.ts    Service-role client (server-only; trust-counts usage)
hooks/
  launchFlowReducer.ts  THE plan state machine: pure reducer + normalize() enforcing the
                        invariants (no result without its strategy, selection ⊆ channels,
                        posted marks ⊆ existing posts, step never deeper than the data)
  useLaunchFlow.ts      Thin hook over the reducer: async API actions + ephemeral UI state
  useAutosave.ts        Debounced persist: localStorage (anon) / Supabase upsert (signed-in)
  useGrowthAgent.ts     Account/project-scoped remote job reads/commands, bounded polling,
                        explicit review into the reducer; no localStorage job ledger
components/
  ui/                   Button, Card, Badge, Spinner, Field, Tabs (design system primitives)
  app/                  Stepper, UrlStep, ProfileForm, FactLedger (provenance UI + questions),
                        SourceCoverageReceipt (real fetch/verification/provider receipt +
                        explicit bounded evidence-source inputs),
                        DiagnosisSummary + EvidenceReview (compact first read + full proof),
                        LaunchSetup (Success Contract + date + weekly budget),
                        StrategyView (one next experiment + secondary comparisons/full
                        score library), ResultsView (workspace orchestrator:
                        action-first Today + Strategy Library/Progress/Weekly Review),
                        PlanSummary, CopilotPanel, ProjectBar, SignIn, AuthScreen (guest
                        preview + explicit login handoff), DemoGuide, Paywall,
                        UsageBadge, FeedbackCTA
  app/results/          Interactive workbench (M19/M25.3): TodayTab + InlinePostWorkbench,
                        DraftDecisionSupport, ExecutionProgress, PublishDialog, OutcomePanel, TimelineTab,
                        ReviewTab — plus the full report (PlanReport wrapping
                        the M14 per-tab modules: OverviewTab, ContentTab + ChannelBlock +
                        PostCard, CalendarTab, ExecuteTab, FailuresCard, PrintHeading)
  landing/              Nav, Hero, HowItWorks, PlatformShowcase, Pricing, FAQ, Footer
  legal/                LegalShell — shared frame for the three legal pages
docs/M13-trust-layer.md Design + migration doc for the trust layer (facts/scoring/partial success)
docs/M15-workspace.md   PRD + state diagram + acceptance criteria for the launch workspace
docs/M16-copilot-actions.md  Design contract for the copilot action engine
docs/M17-privacy-trust.md    Private-beta data-flow map, inventory, threat model and controls
docs/M18-growth-workspace.md Product contract for lifecycle modes, next-best-move and reminders
docs/M19-execution-workbench.md Interaction contract for visible click feedback and the
                        Prepare→Publish→Measure→Learn loop
docs/M20-truthful-execution.md Product contract for explicit publisher voice, deterministic
                        draft truth gates, channel-consistent Copilot and honest zero results
docs/M21-product-system-audit.md Pre-launch audit: journey/state maps, evidenced P0–P3
                        findings, fix scope and acceptance criteria
docs/M23-first-value.md Landing/guest preview/demo/handoff contract and activation boundary
docs/M24-product-measurement.md Guest-preview production acceptance, aggregate funnel,
                               retention definitions and privacy/operator contract
docs/M24.1-correctness.md Outcome Verdict, legacy history, tracked URL and execution-id contract
docs/M25-evidence-receipt.md Server-authored source coverage, multi-page evidence and v8 contract
docs/M25.1-success-contract.md Compact Diagnose, measurable success definition and v9 contract
docs/M25.2-focused-strategy.md One-decision Strategy, deterministic rank/migration contract
docs/M25.3-experiment-contract.md Auditable Prepare/Publish contract, repair Diff and Share Kit
docs/M26-calibrated-continuity.md A/B delivery: honest observations, graded learning,
                                confirmed queue, frozen publish history and QA boundary
docs/M26.C1-source-trials.md Source→trial-kit→confirm→queue slice; budgets, provenance,
                           no-background-job boundary and pending production acceptance
docs/M26-release-acceptance.md Explicit release scope, signed-out smoke evidence,
                              required real-provider/cloud/account acceptance
scripts/release-smoke.mjs  Credential-free public release gates; never labels smoke
                          as full production acceptance or invokes a model/deletion
scripts/research-acceptance.ts  Explicit bounded provider acceptance, controlled scenario,
                               local continuity checks; not authenticated production QA
docs/M26.C1-provider-acceptance.md Recovery fixes and the exact live-provider evidence boundary
docs/M26.C1-cloud-boundary-audit.md Async ownership/save/export audit, regression fixes,
                                  remaining major dependency and real-account gates
docs/M26.C1-dependency-migration.md Approved Zod 4/OpenAI SDK 7 security migration,
                                  installed-SDK wire regression and release boundaries
tests/                  vitest suites: urlPolicy, safeFetch, billing, webhook route, validate,
                        golden (12-fixture offline evals), generateRoute, flowReducer
                        (state-machine invariants), storage (draft migrations), workspace
                        (Today/verdicts/review), source coverage/analyze route,
                        Success Contract normalization/target reads/history snapshots,
                        execution (lifecycle/countdowns),
                        coerce (metric parsing), export (learning-loop
                        completeness), copilotActions (action boundary, injection,
                        destructive gates, memory), account (deletion coverage vs schema,
                        export), guest preview (quota/config/token/route/orchestration/handoff),
                        retention, log (redaction), privacy (source consistency, provider
                        ordering); eval.live (gated)
tests/golden/           fixtures.ts — 12 product-type golden fixtures with ground truth
supabase/schema.sql     projects + entitlements + webhook_events + M15 campaigns/
                        experiments/outcomes (checkpoint verdict)/tasks tables
                        (owner-only RLS) + delete RPC
supabase/migrations/    production-safe, transactional repair migrations
supabase/audit.sql      single-result PASS/FAIL report for project columns/tables/RLS/
                        policies/cascades/RPC
.github/workflows/ci.yml  dependency audit · typecheck · lint · format:check · offline tests · build on every push/PR
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
- **Guest-preview spend boundary**: the route is off unless its signing secret, eligible
  provider and persistent Upstash store are configured. Same-origin and URL syntax checks
  precede an atomic Lua reservation for both a signed-random-visitor limit and a shared
  global hard cap; store/config errors fail closed before scrape/model calls. Redis receives
  only a keyed digest and counters — never URL/page text/draft/IP/UA/fingerprint.
- **Polar**: webhook fails closed (503) without `POLAR_WEBHOOK_SECRET`; verifies Standard
  Webhooks HMAC + timestamp (±300s), dedupes by webhook-id in `webhook_events`, and only
  acts on allowlisted event types whose product id matches `POLAR_PRODUCT_ID` and whose
  user id is a UUID. Checkout `success_url` comes from the `SITE_URL` allowlist — the
  Origin header is honored only when it's in that list.
- **Headers**: global CSP + nosniff/DENY/referrer/permissions/HSTS in `next.config.mjs`
  (dev adds `unsafe-eval` + the Vercel Analytics debug script host).
- **Dependency gate (2026-10-24)**: the old moderate-only PostCSS acceptance
  is superseded. Released repairs use Next 15.5.28, a same-major patched PostCSS override,
  and the explicitly approved Zod 4.6.7 / OpenAI SDK 7.43.0 migration. Full/runtime
  scans currently report zero known advisories; this is not proof of zero bugs.
  CI fails on high/critical advisories without force-upgrading.
  Node 22+ is required by the SDK; model IDs and provider routing are unchanged.

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
npm run audit:dependencies # fail on high/critical known dependency advisories
npm test                 # vitest (offline suites in tests/; no API keys needed)
npm run lint             # eslint . (flat config, non-interactive)
npm run format:check     # prettier --check . (CI-enforced)
npm run build            # must stay green
npm run release:smoke -- https://postbeacon.app # signed-out public gates, not full acceptance
npm run release:research # explicit paid OpenAI controlled-scenario test; never runs in npm test
RUN_LIVE_EVAL=1 npx vitest run tests/eval.live.test.ts   # live provider eval → eval-results/
```

## Deploy (Vercel)
Import repo → set env (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`) → point `postbeacon.app` DNS at Vercel. Accounts need
`supabase/schema.sql` run once in the Supabase SQL editor.

Optional env (each degrades gracefully if unset): `SCRAPE_API_KEY` (Firecrawl, SPA scraping),
`SEARCH_API_KEY` (Tavily, grounded discovery), `SITE_URL` (comma-separated allowlist for the
post-checkout redirect; defaults to https://postbeacon.app),
`NEXT_PUBLIC_PRIVACY_EMAIL` (shown on legal pages only after inbound mail is working), and for metering/billing
`SUPABASE_SERVICE_ROLE_KEY` + `POLAR_ACCESS_TOKEN` + `POLAR_PRODUCT_ID` + `POLAR_WEBHOOK_SECRET`
(point the Polar webhook at `/api/billing/webhook`; without the secret the webhook fails closed).
The signed-out preview additionally needs the complete fail-closed set documented in
`.env.example`: `GUEST_PREVIEW_ENABLED`, a ≥32-byte signing secret, and Upstash REST
  URL/token; DeepSeek needs its separate guest-preview opt-in and the visitor's
  server-enforced pre-submit acknowledgement.

**Live (verified 2026-07-25):** Vercel project `zhengbrodys-projects/postbeacon` → **https://postbeacon.app** + www.
Porkbun DNS: apex `A 76.76.21.21`, www `CNAME cname.vercel-dns.com` (nameservers stay on Porkbun).
Set in Vercel: OPENAI/DEEPSEEK keys; Claude is intentionally disabled. Supabase public configuration is enabled and the
production login gate is active. `SUPABASE_SERVICE_ROLE_KEY` is configured as a Sensitive,
Production-only secret; Preview has only the public Supabase URL/anon key. The original
schema/RLS/cascade audit plus the M24.1 Outcome checkpoint contract are fully green in
production (nine checks): seven tables/RLS, six owner policies, six auth-user cascades,
four workspace-parent cascades, closed webhook ledger and service-role-only transactional deletion
RPC all PASS; `outcomes.verdict` is installed. Billing remains unverified/off unless all
Polar variables are set.
`NEXT_PUBLIC_PRIVACY_EMAIL=privacy@postbeacon.app` is live; Porkbun forwarding delivered an
external inbound test to the monitored founder mailbox. `DEFAULT_PROVIDER=openai`;
`NEXT_PUBLIC_DEEPSEEK_FALLBACK=true` allows a visibly disclosed DeepSeek retry during beta.
Inactive projects and webhook ids are retained for 30 days. `Pricing` is hidden during beta.
Event email code is deployed fail-closed but remains off until Resend/sender/public flag are
configured and verified; in-app reminders remain active. Signed-out preview is live with its
Upstash persistent visitor/global quota, signing secret and DeepSeek pre-submit consent gate;
the 2026-07-25 production acceptance passed first success, repeat 429, consent 400 and
cross-origin 403. Aggregate product-health reporting is operator-only at `/api/metrics`.
Redeploy: `npx vercel --prod --yes`. Push env from `.env.local`: `~/push-env.sh`.

## Status / changelog
- **2026-10-26**: **C.3 Beta released; persistent Agent on, daily search fail-closed.**
  User approved production installation/enablement and one public-data acceptance
  (at most three Tavily searches and one OpenAI request). `4f20213` passed CI
  `40291528947`; daily-trigger follow-up `d3a931b` passed CI `40293017202`.
  Production `dpl_5a5KTfjtUPaYVFF28ebcAHoLKSWw` is Ready and owns postbeacon.app/www
  (54s build). Both migrations were installed in PostBeacon main PRODUCTION:
  base nine + Agent eight + mission ten audit rows all PASS. Production-only
  `AGENT_RUNS_ENABLED=true` / `AGENT_MISSIONS_ENABLED=true` are configured; Vercel
  independently confirms the authenticated mission tick once daily at 12:00 UTC.
  `SEARCH_API_KEY` is absent in this exact project, including linked shared variables;
  effective daily missions remain unavailable. User deferred this setup and requested
  a one-time reminder for Oct 27, 10:00 America/Los_Angeles, which was created.
  A dedicated public/synthetic PostBeacon QA project—not MindMarket—completed exactly
  one product-led OpenAI `gpt-4o` task, status ready. Refresh restores it and account
  export includes the single run plus missions array; published executions remain zero.
  No Tavily/DeepSeek call, social publication or account deletion. The tested draft
  repeated its opening and exposed an inline fact ID: editorial/native-format review
  is still required, not silently repaired or claimed publication-ready. Two-real-account,
  public-search, mission pause/expiry and natural scheduled-run acceptance remain.
  Node 24: 802 offline tests pass (three live skipped), normal gates and 32 isolated
  PostgreSQL scenarios pass. Six production smoke gates pass; bounded five-minute
  error/fatal scan returned zero records. See the C.3 document for exact scope.
- **2026-10-25**: **C.3 daily research pilot — locally accepted, not released/enabled.**
  Three parallel agents split authorization/SQL/worker, public-source research and
  UI/account-scoped commands, followed by cross-review. Today now exposes explicit
  query/domain delegation, separate search/OpenAI approvals, revision/30-day expiry,
  Check now and Pause. No automatic posts, contacts or DeepSeek standing fallback.
  Shared atomic budgets, no ambiguous search retry, owner isolation and account
  export/delete cover the new authorization. Background work does not refresh
  project activity/retention. No production migration, enablement, scheduler, paid
  call or release occurred. See `docs/M26.C3-daily-research-pilot.md` for scope and
  separate installation/acceptance gates; this is not an always-on 24-hour assistant.
  Cross-review also closed autosave/paid-checkpoint TOCTOU and delete/worker lock
  ordering. Node 24.22.1: 801 offline tests pass (three live skipped), 32 isolated
  PostgreSQL scenarios and both SQL audits pass; typecheck/lint/format/build and
  dependency audit pass (zero known advisories). Built-app fictional desktop/mobile
  QA at 1280×720/375×812 has no page overflow or captured warnings/errors; ten
  local signed-out smoke probes pass. Real account/provider/cron acceptance remains.
- **2026-10-25**: **C.2.2 visible CMO Brief / trial kit — release acceptance.**
  App commit `f5f5565` passed GitHub CI `40250904725`; production deployment
  `dpl_A5zpNMtNEeGj641E79wW5XdpKz4k` is Ready (41s build), with postbeacon.app/www
  verified as aliases. Six public smoke checks passed at `2026-10-26T00:47:30.798Z`;
  the deployment's bounded five-minute error/fatal scan returned zero records.
  Local Node 24.22.1: 683 offline tests pass, three live skipped, all normal gates
  and 19 isolated PostgreSQL scenarios pass. Actual 1280×720 / 375×812 browser QA
  has no page overflow or captured warnings/errors. Production fictional QA verifies
  editable Brief → review → dual confirm → matching Today draft; no real task writes.
  Three subagents split product-mode orchestration, Brief/UI and independent boundary
  review. Today opens with an editable audience/task/feedback Brief; product-led
  invitations require verified facts but no external demand sources. Evidence mode
  retains its source checks; old inputs never silently change mode. Review exposes
  draft/entry/steps/facts/goal/screenshot jobs and still requires two confirmations.
  Canonical queue state drives step feedback and Today selection. Publishing success
  waits for the reducer's actual experiment ID, not merely a callback. Reviewed-context,
  approved-entry and banned-claim checks protect actual draft identities in Today,
  individual library copy and bulk copy; derived Share Kit copying is disabled for
  trial drafts. Historical exports remain available. No new dependency/SDK/model,
  automatic post, connector, production schema mutation or flag enablement.
  Read-only production investigation confirmed the new Agent installation is absent:
  eight Agent audit rows FAIL; all three Agent tables resolve to NULL in PostBeacon
  main PRODUCTION. This does not invalidate the earlier base RLS acceptance. Real
  persistent execution remains OFF pending separately approved installation and
  account/provider acceptance. See `docs/M26.C2.2-cmo-trial-workbench.md` for evidence.
- **2026-10-25**: **C.2.1 assisted handoff released after explicit approval.** App
  commit `eeb30bb` passed GitHub CI `40171171849`; Next.js/Node 24.x production
  deployment `dpl_3HnQBj42abmApc33Lue7Xfq9f3rm` is Ready (44s build) and owns
  postbeacon.app/www. Six public smoke checks passed at `2026-10-25T07:02:05.914Z`;
  the added draft-URL/history privacy notice is live. Production fictional browser
  QA confirms the new shortcut and disclosure at actual 1280×720, with no horizontal
  overflow or captured warnings/errors. No social post/connection, SQL/env change,
  paid model request or Agent enablement occurred. Authenticated X composer prefill
  remains unverified; Copy/Open fallback and final manual publication are required.
  Multi-platform API delivery remains planning, not an implemented connector.
- **2026-10-24**: **C.2.1 assisted publishing — accepted local slice, authorized release pending.**
  Three subagents split official API feasibility, execution-boundary audit and pure
  handoff implementation. Added fixed-origin X single-post prefill with current
  Truth Gate, conservative weighted length/URL limits, no truncation and explicit
  draft-in-URL/history disclosure; other channels/threads remain copy-and-open.
  Opening never records a publish or consumes an experiment. Fixed popup null-handle
  misreporting and a reproduced A→B→A stale-command finally race that released a newer
  command's duplicate-click lock. No new dependencies, models, token storage, SQL or
  production flag changes. Future approved API distribution (Buffer X/LinkedIn,
  DEV drafts; Reddit manual) is a separate, not implemented product contract; see
  `docs/M26.C2.1-assisted-publishing-plan.md`. Local 1280×720/375×812 fictional UI
  has no horizontal overflow or captured warnings/errors. X intent preserves its
  text through a sign-in redirect; authenticated composer/media/publication remains
  unverified. Node 24.22.1: 626 offline tests pass (three live skipped), typecheck,
  lint, format and production build pass; dependency scan has zero known advisories.
- **2026-10-24**: **C.2.0 code released, Agent execution deliberately OFF.** User
  authorized accepted code publication only. App commit `1ed30d5` passed GitHub CI
  `40161487756`; Vercel `dpl_BWc65fr5iH5XwW6FCvwapXTACC8x` is Ready and owns
  postbeacon.app/www (Node 24.x, Next.js; build 1m11s). Production has no
  `AGENT_RUNS_ENABLED` variable; no SQL/env change or paid request was performed.
  Post-release signed-out smoke passed six checks at `2026-10-25T04:21:22.594Z`;
  new Agent GET/POST return 401 and foreign-origin POST returns 403. Production
  fictional UI shows the top-level research entry at actual 1280×720 with no
  horizontal overflow or captured warning/error logs; no cloud task/account write
  was used as evidence. Real task enablement and cloud/provider/account acceptance
  remain separate gates. Full local revalidation: 598 offline tests (three live
  skipped), typecheck/lint/format/build, zero known dependency advisories and 19
  isolated PostgreSQL scenarios pass. This is not a fully enabled autonomous Agent.
- **2026-10-24**: **C.2.0 visible persistent research — local implementation.** Today
  now puts Growth Agent first and gives legacy/unsaved projects explicit setup paths.
  Added flag-closed owner-scoped tasks, composite project-owner FK, transactional
  user/global UTC daily reservations, one fenced worker/model attempt, explicit
  pre-model resume and cancellation fencing. Completed jobs require manual review
  before the existing dual-confirm/queue boundary. Export/delete/retention/privacy
  cover tasks and counters, including a server-written initialization marker so
  pre-install accounts remain exportable without hiding unreadable later history.
  No new framework, provider, model, automatic publisher or always-on scheduler.
  Independent local PostgreSQL acceptance and offline/UI gates are recorded in
  `docs/M26.C2.0-bounded-agent-runs.md`: 598 offline tests (three live skipped),
  eight SQL audit rows, 19 named PostgreSQL scenarios, 1440×1000/375×812 fictional
  browser QA and six built-app signed-out smoke probes pass. Production SQL/flag, real account/provider
  acceptance and activation/retention remain pending; this is not the whole C.2.
- **2026-10-24**: **Authorized security/account-boundary release deployed.** Pushed
  `c2fc40c`, `5e6454c` and deterministic-test follow-up `22e92a1` to main.
  GitHub CI `40149521584` passed all gates; Vercel deployment
  `dpl_H2WQsNMgFcRNJ84PnS2FBVLnnSzH` is Ready and owns postbeacon.app/www.
  Commit-linked Vercel status independently matches `22e92a1`. Post-release public
  smoke passed all six gates at `2026-10-25T01:11:04.493Z` (October 24 locally).
  A bounded deployment error/fatal log scan returned zero records, not proof of
  error-free behavior or a completed monitoring setup. No SQL/env/model changes,
  paid requests, real account writes/deletes or social posts occurred. Real cloud
  save/export/account isolation and fresh migrated-SDK provider acceptance remain
  pending; C.2 is not delivered. CI action-runtime/runner deprecation notices are
  non-failing maintenance follow-ups. Earlier local-only entries are historical.
- **2026-10-24**: **Runtime gate resolved; authorized release revalidated.** Official
  Vercel CLI login and existing-project inspection confirm
  `zhengbrodys-projects/postbeacon` uses Node 24.x; no runtime/env setting changed.
  Full local typecheck/lint/format/569 offline tests (three live skipped)/production
  build pass under Node 24.22.1; dependency audit reports zero known advisories.
  The fresh pass exposed an intermittent bad-signature test fixture: replacing the
  first Base64 character with `x` sometimes did not corrupt it. A fixed-clock
  reproduction failed before repair; the fixture now flips a signature bit and
  restores its clock mock. Production signature verification is unchanged.
  Local and pre-push production smoke each pass six gates. This clears the runtime
  pre-push blocker, not authenticated cloud/provider/retention acceptance or C.2.
  The MCP plugin is installed, but its team grant remains unavailable; the CLI
  can access the intended project. Release completion is recorded separately.
- **2026-10-24**: **Release-candidate browser acceptance + Review evidence repair.**
  Actual built-app 1440×1000 desktop and 375×812 mobile fictional walkthroughs passed
  Prepare/Publish/Measure/Learn and C.1 review/dual-confirm/queue/cancel/second-execution
  continuity, with no horizontal overflow or captured browser warnings/errors. QA
  exposed early 24h target reaches being promoted to "best angle" before the stored
  72h window. A failing regression preceded the fix: Review and Copilot now reuse
  final-window angle evidence, exclude conflicts and show evidence grades, while
  checkpoint/loop counting remains unchanged. 569 offline tests pass, three live
  skipped; local typecheck/lint/format/build and dependency scans pass. Production
  release was authorized after acceptance, but push is gated on confirming Node ≥22:
  the controlled Vercel session remains at login. App candidate `c2fc40c` is locally
  committed, not pushed; fresh local and old-production public smoke each pass six
  probes. Direct runtime-version confirmation is pending. No SQL/env/model/credential change, real account
  write/delete, model call or deployment occurred at this checkpoint. See release
  acceptance for the remaining cloud/relational/retention/C.2 boundary.
- **2026-10-24**: **Approved dependency migration — local, not deployed.** Updated
  Zod to 4.6.7 and OpenAI SDK to 7.43.0, resolved the two remaining high dependency
  entries and kept one deduped Zod copy. Adapted static enum/literal error mapping
  and pre-validation non-finite metric normalization (absent, never zero). Actual
  installed-SDK offline wire tests preserve OpenAI/DeepSeek endpoints, models, JSON
  mode, token budgets, ordinary fallback and C.1's no-retry/fallback/repair boundary.
  No model-transport code or API family change was needed. CI now blocks high/critical
  dependency advisories; README documents Node 22+. Clean install, 568 offline tests
  (three live skipped), typecheck/lint/format/build and six local signed-out HTTP smoke
  probes pass under Node 22.23.4; full/runtime scans report zero known advisories.
  No paid provider call, cloud write, SQL/env/runtime setting or deploy occurred.
  Changes are uncommitted; real cloud/account/relational/concurrency acceptance and
  C.2 remain pending. See `docs/M26.C1-dependency-migration.md` for exact evidence.
- **2026-10-23**: **Pre-cloud acceptance audit — local stabilization, C.2 not started.**
  Found stale async result/account-command ownership, overlapping save ordering and
  silent >1,000-row export truncation. Added shared ephemeral scope/abort control,
  owner/project keyed ordered saves including mirrors, ownership-bound data-rights
  calls and complete counted export pagination. Actual React Hook + deferred-network
  regressions supplement pure tests; jsdom is development-only. Compatible dependency
  patches remove the initial critical runtime advisory; Zod/SDK major migration is
  still an explicit approval/security gate. Real QA accounts, cross-device conflict
  control and relational parent/child ownership constraints remain separate checks.
  Final local checks: 550 offline tests pass, three live tests skipped; typecheck,
  lint, format, production build and six built-app signed-out HTTP probes pass.
  Full/runtime dependency scans each retain two high entries; no clean audit is claimed.
  Changes are local, uncommitted and not deployed; fresh visual/cloud QA is pending.
  See the cloud-boundary audit for scope and limitations. No new SQL, model call,
  production account write/delete or autonomous Agent was added by this audit.
- **2026-10-23**: **Explicitly approved DeepSeek controlled acceptance passed.** One
  `deepseek-chat` C.1 invocation returned one review-ready opportunity; protocol and
  all six local acknowledgement/queue/idempotency/export-hydration/no-publish checks
  passed. The bounded, content-free report is in ignored eval-results. Only the
  previously disclosed public product description and hypothetical scenario were
  sent; no fallback, private account data, cloud write or real publication occurred.
  This closes the controlled DeepSeek check, not real signed-in production acceptance
  or C.2. No application code, configuration or deployment change was needed.
- **2026-10-23**: **C.1 recovery correctness + bounded provider acceptance.** Unchanged
  project hydration now preserves canonical user-confirmed goal provenance instead of
  restamping its verification time and invalidating pending research. Changed goals
  still invalidate old research. Trial source truncation flags survive queue/snapshot
  normalization. Both issues were reproduced with failing regressions before repair.
  Added an explicit one-invocation-per-selected-provider acceptance runner: OpenAI
  default, separately acknowledged DeepSeek only, no Claude/fallback/source fetching,
  controlled hypothetical demand and simulated local confirmation only. Reports separate
  protocol/content/local continuity and never claim full production acceptance. One
  real OpenAI controlled integration passed; its detailed console report was not
  retained, so no draft-count/content-readiness conclusion is asserted for that run.
  Future runs persist non-content report files. DeepSeek was initially pending and
  subsequently passed the separately approved controlled check above. Real signed-in
  cloud/account acceptance, real activation/retention and C.2 remain pending. No SQL/env/vendor change.
  Local gates: 522 offline tests passed, three live tests skipped by default;
  the separate one-call OpenAI live case passed. Typecheck/lint/format/build passed.
- **2026-10-12**: **A/B + C.1 deployed after authorized smoke.** App revision
  `93bae90` was committed/pushed to main; GitHub CI 38331172722 and the commit-linked
  Vercel deployment passed. Fresh post-deployment public smoke passed all six gates
  on postbeacon.app at 2026-10-13T01:15:48.902Z: new research route and trial privacy
  text are live; unsigned research/export and public metrics remain closed, foreign
  research origins are rejected. Fictional online browser QA verified kit review,
  dual confirmation, independent ready queue, cancel-without-consumption and simulated
  publish into Measure. Actual runtime widths 643 and 341 px had no horizontal overflow
  or captured warnings/errors; requested mobile size was not treated as observed size.
  No real model call, source fetch, cloud save/delete, account switch, social posting,
  new SQL or environment change occurred. Real provider/persistence/account/retention
  acceptance and C.2 jobs/budgets remain pending; see the release acceptance record.
- **2026-10-12**: **A/B + C.1 release acceptance preparation.** Added a portable native-fetch
  release checker with fixed, credential-free probes, no redirects, request/body bounds
  and non-sensitive JSON results. A passing public smoke explicitly does not imply full
  production acceptance; real provider/cloud persistence/account isolation remain required.
  Eight checker regressions cover missing/disabled routes, stale privacy text, redirects,
  credential-free behavior and bounded/redacted failures. A fresh production read found
  `/app` 200 and existing export/metrics auth gates 401, but `/api/opportunities` 404 for
  both unsigned and cross-origin requests and the trial-research privacy notice absent.
  No production writes/model calls/deletion/deployment were performed. Release promotion
  was subsequently authorized by the user after smoke; C.2 jobs/budgets are not
  part of this release. Deployment results are recorded separately below when verified.
  The built local app passed all six probes at its canonical `localhost` origin;
  the `127.0.0.1` alias was rejected by the same-origin check, which was not weakened.
  Final candidate gates: 505 offline tests passed, two live tests skipped; typecheck,
  lint, formatting, production build and diff checks passed. This does not replace
  authenticated production, provider, cloud persistence or retention acceptance.
- **2026-10-12**: **C.1 — source-backed product-trial preparation (local, not deployed).**
  Today exposes an explicit-source workbench: up to three short demand excerpts, a
  same-origin product trial, founder-provided three steps and feedback question, and a
  publication venue separate from the evidence source. Optional static fetch is SSRF-safe,
  redirect-free, renderer-free and bounded; receipts distinguish quote found/not found,
  fetch failure and unverified submitted excerpts. Fit remains a hypothesis; freshness,
  demand and venue permission are not invented. One selected OpenAI/DeepSeek model request
  has no SDK retry/provider fallback; Claude is not enabled. Truth/approved-link/literal
  banned-claim gates, stale-context/form guards and two founder acknowledgements precede
  atomic ready-queue confirmation. Publication freezes the trial audience/source/steps
  alongside existing draft/fact/voice/goal history; discard does not erase confirmed trials.
  Schema v11 stays in owner-scoped project JSON, exports and existing deletion/retention.
  No SQL/env/vendor change; privacy notice/inventory updated. A hostname-only demo bug
  caught by browser QA was fixed with a regression; the Copilot route's missing draft-index
  forwarding was also repaired. Resumable Agent jobs, atomic global spend budgets,
  real activation/retention and connectors/MCP remain pending. See C.1 delivery doc.
  Final gates: 497 offline tests passed, two live tests skipped; typecheck, lint,
  format, production build and diff checks passed. Desktop 1440×1000 and real mobile
  375×812 development-browser source→review→dual-confirm→queue→publish paths passed
  with no model requests, warnings/errors or horizontal overflow; A/B continuity was
  rechecked. Direct local research probes returned signed-out 401 and cross-origin 403.
  These are local/mock/fictional checks, not fresh production/provider/account acceptance.
- **2026-10-11**: **M26 A/B — calibrated learning and continuous experiments (local,
  not deployed in this turn).** Unknown/unavailable observations no longer become zero,
  invalid tests retain history but do not become losing memory, and channel-specific
  signals/custom labels/72h deltas lead Measure. Angle memory is rebuilt from eligible
  final Outcome reads, distinguishing early/repeated/conflicting evidence rather than
  promoting promising reads into wins. Search-result URL membership is enforced separately
  from reachability; community content/rules are not claimed as reviewed. Share Kit defaults
  to the user's product and blocks unsafe or overlong copy instead of clipping claims.
  Copilot variants bind platform/index and source text; stale Apply is blocked. Publish
  freezes audience, voice, facts, draft and success rule. Explicit follow-up confirmation
  creates an independently identified planned test, preparation appends a new draft, and
  publishing consumes the queue atomically; cancel/duplicate/late-response paths are tested.
  Changed held conditions downgrade comparisons to exploratory. Schema v10 uses existing
  owner-scoped project JSON; no SQL, environment, vendor, billing or posting integration
  was added. Aggregate counts exclude insufficient/invalidated reads and fetch only a
  bounded assessment label, never metric values. Growth Agent research/jobs/connectors
  remain future stages, not implemented by this milestone. 451 offline tests pass
  (two live tests skipped); typecheck, lint, format and production build are green.
  Desktop 1440×1000 and mobile 375×812 fictional walkthroughs exercised a confirmed
  second experiment and unavailable-result handling without model calls or horizontal
  overflow. Dev browser runs were clean; local production runs encountered the absent
  Vercel Analytics endpoint, so production assets/account/provider acceptance remains
  a release check rather than a claimed live verification.
- **2026-08-12**: **M25.3 — Prepare and Publish are auditable.** The primary
  draft now opens with one Experiment Contract assembled from canonical profile,
  recommendation and Success Contract state: audience/venue, one tested Hook,
  held-constant angle and the exact 24h/72h decision rule. Hook selection emits a
  visible before/after change receipt. `Why this draft` exposes only recommendation-
  cited Fact IDs, the deterministic platform-catalog rule, the selected angle and
  explicit inference warnings; missing legacy evidence stays missing. A blocked
  Truth Gate now opens a tightly scoped Copilot repair request, while the existing
  proposal/confirm boundary shows Hook and Body diffs, preserves the original,
  selects an applied variant and reruns the deterministic gate. A lightweight Share
  Kit provides three ordered screenshot jobs, focus notes, alt text, a privacy-
  redaction reminder, bounded three-part X copy and a LinkedIn version. Publish repeats
  the contract and names the already-persisted fields it snapshots, so no duplicate
  contract object, SQL, env, vendor or storage-version change was added. 427 offline
  tests, typecheck, lint, format and production build are green. Desktop browser QA
  verified both disclosures, the Hook receipt and publish snapshot; a real 375×812
  viewport had no horizontal overflow and the browser logged no warnings/errors.
- **2026-08-10**: **M25.2 — Strategy is one executable decision.** Strategy no
  longer opens with a report and four preselected channels. A deterministic projection
  now selects exactly one recommendation by computed score, canonical catalog order and
  platform ID; the first card exposes venue provenance, best move, goal fit, an explicitly
  labelled effort estimate, stored risk, the Success Contract signal and the factual reason
  #1 outranks #2. `Prepare this experiment` sends one platform to generation, while top-three
  comparison, all ranked channels and the complete strategic narrative remain secondary
  disclosures. An explicit replacement action cannot leave zero or multiple choices. Old
  unfinished multi-select projects focus on their highest-ranked selected channel; generated
  historical multi-channel plans remain unchanged. The fictional walkthrough now projects
  an already-baked selected channel locally, so its no-model-call promise also holds when a
  visitor returns to Strategy; absent example drafts are labelled instead of invented.
  No SQL, env, vendor, analytics or storage-version change was added. 423 offline tests,
  typecheck, lint, format and production build are green. Desktop QA verified recommendation,
  alternative choice and one-channel Prepare with no generate request; a real 375×812
  viewport verified 44 px primary CTA, no horizontal overflow and no browser warnings/errors.
- **2026-08-04**: **M25.1 — compact Diagnose + a real Success Contract.** Diagnose
  now opens with only Product, Audience, Main value, Primary goal and deterministic
  verified/inferred/unknown counts; exact quotes, source coverage and the complete
  Fact Ledger remain editable under one Review all evidence disclosure, while the
  working diagnosis and full profile editor are secondary disclosures. Primary Goal
  is no longer display-only: the founder explicitly chooses a primary signal, optional
  comparable baseline, meaningful minimum result and 24h/72h decision window. One
  validated workspace contract feeds Strategy, generation, Copilot, Today and export;
  the reducer atomically snapshots it onto every published Experiment, so later goal
  changes cannot rewrite history. Measure leads with that experiment's primary signal
  and folds secondary observations. Verdict reads the stored target: reached,
  baseline-improving, early, unmeasured and final-miss paths are deterministic and
  explain their rule; pre-v9 experiments retain the legacy rule rather than receiving
  a fabricated historical target. Draft schema v9 rides existing local/project meta
  JSON, with no SQL, env, vendor or analytics change. 414 offline tests, typecheck,
  lint, format and production build are green. The fictional browser walkthrough
  verified goal→contract updates, contract-visible publish, primary-signal Measure and
  a target-reached read on desktop and a real 375×812 viewport, with no horizontal
  overflow or browser warnings/errors.
- **2026-08-04**: **M25.0 — visible evidence boundary.** Signed-in Analyze now returns
  and persists a server-authored receipt: validated/fetched source counts, static vs
  rendered mode, truncation, final source URLs, verified/inferred/unknown/demoted facts,
  submitted-extract coverage labels and the actual provider/model/fallback. Operators may
  explicitly add up to four Pricing, Docs, Changelog or GitHub pages; PostBeacon never
  crawls adjacent pages, preflights every URL through the existing SSRF policy, fetches
  with concurrency two and isolates optional failures. Multi-page Fact verification now
  finds the exact submitted corpus containing each quote instead of assigning every fact
  to the landing page. Draft schema v8 stores only the bounded receipt in localStorage or
  `projects.meta`; untrusted saved JSON is normalized before UI use and no body, prompt,
  identity or raw upstream error enters the receipt. Markdown/JSON exports retain the
  compact provenance. The fictional demo labels its receipt as example data/no model call.
  404 offline tests, typecheck, lint, format and production build are green. Desktop
  browser QA verified the Diagnose receipt, source disclosure and zero console errors;
  the available in-app browser again ignored its requested 375px viewport override, so
  this milestone does not claim a fresh mobile-runtime pass. No SQL migration is required.
- **2026-08-02**: **M24.1 — correct experiment history and safe tracked links.** Each
  new Outcome now owns the deterministic Verdict produced at that checkpoint;
  Experiment.verdict remains only the latest/final compatibility summary. Timeline,
  Markdown export, lifecycle and Copilot no longer project a 72h read backwards onto
  24h. Unrecoverable pre-v7 reads are labelled “Historical final verdict — checkpoint
  unavailable” and are never fabricated into old Outcome rows. The additive
  `outcomes.verdict jsonb` migration deliberately performs no backfill. Live-post URLs
  now cross one absolute HTTP(S)-only input/render/mirror seam, so javascript:, data:,
  mailto:, relative and protocol-relative values stay inert. Publish task identity is
  now draft-specific (`post:<platform>:<index>`), record tasks remain experiment +
  checkpoint specific, and legacy platform-only tasks suppress only the first draft;
  a generated variant on the same channel can become a separate experiment. Draft
  schema v7, normalized mirror and production audit were synchronized. 394 offline
  tests, typecheck, lint, format and production build are green. The desktop fictional
  walkthrough verified blocked unsafe URLs, valid-link publish, checkpoint recording and
  checkpoint-specific Timeline output with zero browser warnings/errors; the sole in-app
  browser ignored its requested 375px viewport override, so this milestone does not claim
  a fresh mobile-runtime pass.
- **2026-07-25**: **M24 — guest-preview acceptance + privacy-safe product metrics.** The
  live guest route passed a fresh production run (one truth-checked channel/draft with real
  provider provenance), same-visitor repeat limit with `Retry-After`, DeepSeek acknowledgement
  rejection and cross-origin rejection. The core first-value and execution stages now emit a
  fixed cookieless Vercel funnel; one central guard permits only provider/checkpoint/mode/source
  enums and structurally drops URLs, content, identities and outcome values. A new
  `CRON_SECRET`-gated `/api/metrics` reads only keys/timestamps from the existing normalized
  workspace mirrors, returns aggregate saved→plan→publish→measure→learning-loop conversion,
  current/prior 7-day activity, returned users and completed loops, labels sub-10 baselines as
  directional, and fails instead of truncating. Manual early reads never inflate completed
  loops. No SQL, new behavior table, cross-user content dataset, or public dashboard was added;
  privacy/terms and `docs/M24-product-measurement.md` describe the exact boundary. 378
  offline tests, typecheck, lint, format and production build are green.
- **2026-07-21**: **M23.1 — signed-in first review matches the first-value promise.** A
  production MindMarket run showed the authenticated Diagnose step still expanded every
  fact, question, preference, diagnosis and profile field at once. It now leads with only
  unresolved AI suggestions and one required growth-goal choice; verified evidence, plan
  preferences and the full editor use explicit disclosures. Internal fact keys are replaced
  by human labels, observed claims no longer ask for redundant confirmation, and all review
  actions have 44 px mobile targets. `Help me decide` became an unambiguous `Use recommended`
  action with visible selected state. Working diagnosis copy is separated from evidence.
  Code now turns every inferred stage/conversion/assets claim into an honest unknown before
  question selection, preventing guesses such as `start free trial` from appearing as launch
  context. Analyze prompt `a4` also requires distinct, product-specific diagnosis fields.
- **2026-07-21**: **M23 — first value before the full report.** Public positioning now
  leads with verified facts → one experiment → manual publish → measured result → next move,
  including metadata and OG. Signed-out users can receive one best channel and one
  truth-checked draft through a new fail-closed preview route: same-origin + SSRF policy,
  signed random visitor token, atomic persistent visitor/global quota before any scrape or
  model call, provider provenance, no project write and no URL/content/IP/UA/fingerprint in
  the quota store. Provider routing and any DeepSeek risk appear before submit, with the
  acknowledgement enforced server-side. A canonical source receipt prevents stale results;
  browser waiting can be stopped after 90s with honest quota copy. A separate one-hour
  browser handoff uses a 30-minute, one-time callback nonce, then requires an explicit
  continue action and clears on account switches. The fictional demo
  now walks through the real Prepare→Publish→Measure→Learn projections without model calls,
  publishing or autosave; live generation controls explain the boundary instead. Privacy,
  vendor inventory, FAQ and operator env contract were synchronized in
  `docs/M23-first-value.md`. 368 offline tests, typecheck, lint, format and production build
  are green. Browser-verified on desktop and 375 px: no horizontal overflow, ≥44 px primary
  onboarding controls, the complete four-step state transition, reload-to-canonical demo,
  SSRF rejection before work, deployment-aware privacy copy and zero console errors.
- **2026-07-15**: **M22 — generation quality quantified.** The live golden eval now runs
  the M20/M21 truth gate and character budget over every generated draft and reports
  truth-gate clean rate, issue-code distribution and the single-fit / thread-only /
  UNPOSTABLE split per provider (openai content sample widened to 4 fixtures). Live run
  (openai + deepseek, 20 drafts): **zero unpostable X drafts** on either provider — the
  M21 prompt contract holds, so no generation-side retry was added (decision recorded:
  a retry would hide gate failures the product intentionally surfaces as editable,
  regeneratable drafts). deepseek writes long (10/12 X drafts need the thread path —
  the workbench's amber hint covers exactly this); the tightened metric gate catches
  real fabrication in the wild (unsupported-metric/brand-impersonation/
  unsupported-limitation seen on 61% of deepseek drafts, 25% of openai drafts, all
  blocked from Copy/publish until repaired). Voice lint (seamless/leverage/unlock)
  remains the weakest content metric — noted for a future voice.ts pass, no code
  change. eval-results/report.{md,json} carry the new sections.
- **2026-07-15**: **M21 — executable platform contract + tighter truth gate.** Pre-launch
  audit first (docs/M21-product-system-audit.md: journey map, state flow, P0–P3 findings
  with file/repro evidence, confirmed-vs-hypothesis split). Two P1s fixed: (1) the
  unsupported-metric gate missed the abbreviation formats models actually fabricate —
  "10k users", "1M downloads", "$50k in revenue", "2k+ signups", "40% of teams" all
  passed; the matcher now handles magnitude suffixes, currency prefixes and "% of"
  linkage while ledger-confirmed numbers still pass. (2) X posts had no character
  contract anywhere (prompt, code or UI) — the demo's own single post was 389 chars and
  unpublishable. PlatformDef gains charLimit (twitter 280, threads 500), the generate
  prompt states the hard limit, and contentSafety adds an over-limit gate that blocks
  only truly unpostable drafts (a blank-line thread whose every segment fits stays
  executable); the workbench shows a live three-state counter (fits single / post as a
  thread / too long) and the demo post was rewritten to 273 chars. Also fixed: "Open
  platform" no longer claims success when the popup was blocked, and CLAUDE.md regained
  the M20 sections it had lost (contentSafety/projectIdentity map rows, M20 doc line and
  changelog). 14 new tests incl. a demo-passes-its-own-bar suite; 333 offline tests,
  typecheck, lint, format and production build green. Browser-verified on desktop and
  375px mobile: counter states, over-limit blocking with exact excerpt, "10k users"
  flagged, thread hint with Copy enabled, zero console errors. Deferred with evidence:
  sub-32px secondary touch targets (P3, needs a design pass).
- **2026-07-15**: **M20 — truthful execution.** A real MindMarket run exposed fluent but
  invented founder identity, anecdotes, testimonials, traction, limitations and a demo-link
  placeholder. Publisher voice is now explicit (brand-safe default or founder); analyze/generate
  prompts forbid those inventions and code strips impossible first replies from non-thread
  channels. More importantly, every draft now runs a deterministic last-mile truth audit beside
  the copy: the exact issue and repair are visible, while Copy, Copy all and every experiment
  entry point stay locked until it passes. Today now opens Copilot on the same channel instead
  of silently defaulting elsewhere; thread-only actions hide when structurally invalid. Result
  check-ins add one-click observed zero response without conflating empty with zero. Duplicate
  saved-project names now show hostname + updated date. The Fact Ledger accepts an exact
  page-verified claim when a model paraphrases only its evidence field. 10 new tests; 319 offline
  tests green.
- **2026-07-14**: **M19 — interactive execution workbench.** Today now keeps the
  recommended post inside the dominant action card: switch hook/draft variants, edit,
  copy, open the known platform destination, regenerate or ask the Copilot without
  navigating through the report. Every click produces nearby status feedback. Confirming
  a manual publish creates a visible receipt, an active-experiment card and a shared
  **Prepare → Publish → Measure → Learn** lifecycle with a live 24h/72h countdown. Founders
  may record a real early signal immediately; it returns an inline deterministic read and
  next actions but cannot inflate the completed-experiment metric before a scheduled
  checkpoint. Due results use the same inline card and replace the form with the verdict.
  Progress projects the current lifecycle; Learn & next replaces empty scoreboards with
  actionable record/prepare controls. No auto-posting, metric fabrication, new SQL or
  parallel state. Desktop/mobile browser verification covered edit, copy failure feedback,
  publish receipt, early-result verdict, Progress and Learn. 8 new tests; 309 offline tests,
  typecheck, lint, format and production build green.
- **2026-07-14**: **M18 — report → growth workspace.** Product contract first
  (`docs/M18-growth-workspace.md`). The same founder now moves automatically from **Launch
  mode** (no measured publish yet) to **Growth mode** (first experiment created). Today became
  a command center with exactly one visually dominant **Next best move**, why-now/time/goal,
  a contextual Copilot entry that prefills the current move without auto-sending, and up to two
  alternatives behind disclosure; the report is now **Strategy Library**, with Progress and
  Weekly Review secondary. A concrete primary growth goal is mandatory; “Help me decide” maps
  stage to a real deterministic goal instead of vague prompt text. Draft schema v6 persists an
  explicit per-project event-email preference. In-app 24h/72h/review reminders stay always on;
  optional Resend delivery is CRON_SECRET-gated, fails closed until every env is set, derives
  only due events, uses Resend idempotency keys plus existing tasks as its delivery ledger, and
  remains off in production. Desktop/mobile browser verification covered action hierarchy,
  alternative disclosure, contextual Copilot, and Launch→Growth; zero console errors. 11 new
  tests; 301 offline tests green.
- **2026-07-13**: **Project-wide bug audit + public README.** Architect pass over
  the whole codebase (baseline: 283 tests green, madge no cycles, zero
  TODO/console). Fixed four real issues: (1) **pasted outcome metrics poisoned
  state** — "12,000" in the results panel became NaN (`Math.max(0, NaN)`),
  silently mis-verdicting the experiment, serializing to null, and then
  **400-ing every later copilot call** for that project; new `parseMetric`
  (lib/coerce.ts) strips separators and rejects non-finite values at the
  source, and the copilot workspace schema's new `metricSchema`
  (null→undefined) stops historical bad data from locking copilot out.
  (2) **Plan export dropped the learning loop** — Markdown/JSON export (the
  ONLY egress for anonymous users) omitted experiments/outcomes/memory;
  ExportSnapshot now carries workspace+memory, Markdown gains an "Experiment
  log" section, wired app page → ResultsView → PlanReport. (3) buildBriefing
  keyed on review suggestion COPY ("no experiment yet"); WeeklyReview now
  exposes structured `unprovenChannel`. (4) sliceJson's error message embedded
  model output — now static (log-hygiene defense in depth). README rewritten to
  the current product (trust layer, workspace, action engine, privacy posture,
  badges, accurate env table); stale claims removed ("bring your own key" era
  copy was already gone; roadmap no longer lists effect tracking, shipped in
  M15). +8 tests (290 offline). Browser-verified: demo publish → timeline →
  export buttons, zero console errors.
- **2026-07-13**: **M17.6 — production project-save contract repair.** A real signed-in
  save exposed `PGRST204`: the production `projects` table predated M11 and its PostgREST
  schema did not contain every field used by the browser upsert (most likely `meta`). Added
  an idempotent, data-preserving migration that installs the full mutable save-column contract
  and explicitly reloads the PostgREST schema cache; `schema.sql` now repairs every historical
  project column instead of only the latest one. The production audit gains an eighth,
  11-column save-contract check so valid RLS/FKs can no longer hide column drift. The UI now
  names a safe missing column for `PGRST204` without echoing arbitrary database detail. Code is
  ready; production remains pending until the operator runs the M17.6 migration and confirms
  all eight audit rows PASS.
- **2026-07-13**: **M17.5 — private-beta truth + save/export hardening.** Public
  Privacy/Private-beta-use/Data-vendors pages now describe only current behavior: removed
  company entity, paid-plan, governing-law and liability placeholders; dormant vendors and
  billing rows render only when actually configured. Project saves no longer fail silently:
  the UI shows a bounded failure state, localStorage failure is detectable, and account export
  first waits for the current project to save (or stops instead of downloading a misleading
  empty file). M15 acceptance boxes and the retention GET-only doc were synchronized.
- **2026-07-13**: **M17.4 — beta account boundary + production policy.** A same-browser account
  switch could leave the previous account's in-memory plan visible even though Supabase RLS correctly
  isolated saved rows. Auth identity changes now hard-reset the flow and local draft; autosave keys
  its decision to the verified user id, with pure transition tests. Production uses OpenAI primary +
  DeepSeek only (Claude disabled), with an explicit public beta opt-in and China/training-uncertainty
  disclosure for automatic DeepSeek fallback. Retention is configured for 30 days; commercial UI
  and Polar billing remain off during beta.
- **2026-07-13**: **M17.3 — privacy-safe provider resilience.** Production Copilot 500s were
  traced to Claude returning 401 (invalid/revoked key); no-user-data probes confirmed OpenAI and
  DeepSeek remained healthy. `generateJsonMeta` now retries auth/credit/rate-limit/network/5xx and
  invalid-structured-output failures through another configured **clear-policy** provider, records
  `fallbackFrom`, logs only provider/status categories, and returns a useful 503 if every safe option
  fails. HTTP 400/content-policy rejection never fails over; at that milestone DeepSeek was not an automatic target.
  Successful fallback becomes the browser flow's new primary, and Copilot visibly names the switch.
  Picker, feedback warning, FAQ, Privacy, Terms and Subprocessors all disclose that a failed primary
  may already have received the prompt before a retry. Added dedicated failover/privacy tests.
- **2026-07-13**: **M17.2 production-schema + first-value follow-up.** The first production
  audit exposed a real deployment drift: only 2/10 expected FK cascades existed, so the app was
  correctly degrading to authoritative `projects.meta.workspace` while the four normalized M15
  tables were absent. Added an atomic production repair migration (workspace tables, owner RLS,
  cascades, service-role-only transactional deletion RPC) and replaced the three easy-to-misread
  audit result sets with one seven-row PASS/FAIL report where missing objects fail explicitly.
  Account deletion now uses the transaction RPC before removing the auth user, with a tested
  pre-migration fallback. Today adds a locally derived Plan ready → First post → First learning
  activation path, making first value visible without collecting cross-user analytics. Production
  `DEFAULT_PROVIDER` changed from DeepSeek to Claude; DeepSeek stays opt-in. Production migration +
  re-audit confirmed all user-data boundaries and found only the pre-M12 `webhook_events` ledger
  missing; a second minimal transactional migration repaired it, and the final seven-row production
  audit is all PASS. `privacy@postbeacon.app` is published and its Porkbun forwarding path passed an
  external inbound delivery test (replies use the founder mailbox address until hosted mail exists).
- **2026-07-13**: **M17.1 privacy follow-up.** An unclear-policy provider can no longer
  outrank a configured clear-policy provider through `DEFAULT_PROVIDER`; DeepSeek remains an
  explicit per-run choice (or usable when it is the only configured provider). Legal pages now
  support a monitored `NEXT_PUBLIC_PRIVACY_EMAIL` with a GitHub fallback until inbound mail is
  tested. Footer copy distinguishes PostBeacon's no-training commitment from the selected AI
  provider's separate policy. Production notes corrected: Supabase login + service role are
  enabled, with the service-role secret restricted to Production and absent from Preview.
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
  unauthenticated, retention 503 unconfigured. Known limits for counsel at that milestone included
  the contact and provider-default decisions; both were resolved on 2026-07-13. Governing law +
  liability placeholders and provider-policy summaries still need counsel review.
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
