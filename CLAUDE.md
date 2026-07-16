# CLAUDE.md — PostBeacon

> Living architecture + status doc. Keep this updated as the project evolves.

## What PostBeacon is
An AI-CMO SaaS for vibecoders. Paste a product URL → PostBeacon scrapes the page,
distills a product profile, scans 19+ platforms and **scores/ranks** them for that
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
(scraping) · vitest + ESLint + Prettier + GitHub Actions CI. Deploys to Vercel.

## Data flow
```
URL ──► /api/analyze  ──► ProductProfile        (scrape + LLM extract)
        /api/strategy ──► MarketingStrategy      (score & rank ALL platforms + positioning)
        /api/generate ──► GenerateResult         (per-platform content + launch calendar)
```
The frontend drives this as a 4-step flow: input → profile → strategy → results.

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
    account/{export,delete}/route.ts   data rights (bearer; delete = typed confirm +
                                       service role, fails closed 503 without it)
    retention|reminders/route.ts       CRON_SECRET-gated daily operator jobs; reminders
                                       are explicit opt-in and fail closed without Resend
    copilot/route.ts                                                 Launch Copilot (plan-scoped CMO chat)
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
                        high-risk outcome promises and platform char limits; blocks
                        copy/publish until repaired
  analysis.ts           Analyze engine (profile + enforced facts + questions) — route & evals share it
  scoring.ts            Explainable scoring: model rates dimensions, CODE computes the 0-100 total,
                        19-platform completeness pipeline (retry→fallback), venue grounding
  generate.ts           Per-platform content+playbook prompt (generatePlatformPosts) — shared by generate+regenerate
  copilot.ts            Launch Copilot: plan+workspace+memory context builder, tool-based
                        {reply, actions} contract (runCopilot)
  copilotActions.ts     The action engine (M16): strict per-tool schemas, id/evidence
                        verification, destructive detection, impact lines, applyActionPlan
                        — the ONLY proposal→state bridge, used on explicit confirm
  voice.ts              ANTI_AI_RULES — house rules injected into content prompts to kill AI tells
  demo.ts               DEMO_PROJECT — a hand-authored full example plan (the no-API-key showcase)
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
  usage.ts              Entitlement read/increment + FREE_LAUNCHES (server metering)
  plan.ts               Shared plan shaping: rank ordering, canonical calendar entries (M14)
  today.ts              Workspace engine (M15): Today derivation (≤3 actions), 24h/72h
                        check-in due logic, one primary move + collapsed alternatives,
                        rule-based verdicts, first-value path, timeline, weekly review
  growth.ts             M18 Launch/Growth mode boundary + stage-aware primary-goal helper
  execution.ts          M19 Prepare→Publish→Measure→Learn lifecycle projection,
                        countdowns and operator-controlled platform destinations
  projectIdentity.ts    Same-name saved-project labels (product + hostname + updated date)
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
  projectSaveError.ts   Bounded Supabase/PostgREST project-save error copy
  storage.ts            Versioned localStorage draft (DRAFT_SCHEMA_VERSION + migrateDraft;
                        v6 includes reminder preference; projects.meta carries the same version)
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
  app/                  Stepper, UrlStep, ProfileForm, FactLedger, StrategyView, ResultsView
                        (action-first Today + Strategy Library/Progress/Weekly Review), PlanSummary,
                        CopilotPanel (Launch Copilot drawer), ProjectBar, SignIn, AuthScreen,
                        Paywall, UsageBadge, FeedbackCTA
  app/results/          Interactive workbench (M19): TodayTab + InlinePostWorkbench,
                        ExecutionProgress, PublishDialog, OutcomePanel, TimelineTab,
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
tests/                  vitest suites: urlPolicy, safeFetch, billing, webhook route, validate,
                        golden (12-fixture offline evals), generateRoute, flowReducer
                        (state-machine invariants), storage (draft migrations), workspace
                        (Today/verdicts/review), execution (lifecycle/countdowns),
                        coerce (metric parsing), export (learning-loop
                        completeness), copilotActions (action boundary, injection,
                        destructive gates, memory), account (deletion coverage vs schema,
                        export), retention, log (redaction), privacy (source consistency,
                        provider ordering); eval.live (gated)
tests/golden/           fixtures.ts — 12 product-type golden fixtures with ground truth
supabase/schema.sql     projects (+ meta jsonb) + entitlements + webhook_events +
                        M15 campaigns/experiments/outcomes/tasks (owner-only RLS) + delete RPC
supabase/migrations/    production-safe, transactional repair migrations
supabase/audit.sql      single-result PASS/FAIL report for project columns/tables/RLS/
                        policies/cascades/RPC
.github/workflows/ci.yml  typecheck · lint · format:check · offline tests · build on every push/PR
eslint.config.mjs / .prettierrc.json   non-interactive lint + format (next lint is deprecated)
```

## Conventions
- TS strict. Components are presentational; state/effects live in `hooks/` or route handlers.
- Brand color = `accent-*` tokens only (defined in `globals.css`), never raw `violet-*`.
- Reuse `components/ui/*` primitives; don't re-style buttons/cards inline.
- No dead code. Self-review each change for duplication and consistency before moving on.
- LLM calls go through `lib/llm.ts`; browser calls through `lib/api.ts`.
- Plan state changes go through hooks/launchFlowReducer.ts actions — never parallel useState
  that can drift. Loose JSON is normalized with lib/coerce.ts, not `any`. Rank ordering and
  calendar entries come from lib/plan.ts (one source, three consumers).
- Security invariants (M12): any user/model/search-supplied URL is fetched ONLY via
  `lib/safeFetch.ts` (`lib/fetch.ts` is for operator-configured endpoints); every API body is
  parsed with a `lib/validate.ts` schema (never `as`-casts); routes expose only `PublicError`
  messages via `apiError`; never log or echo user input, tokens, prompts, or keys. Full
  contract: "Security posture" in AGENTS.md.

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
post-checkout redirect; defaults to https://postbeacon.app),
`NEXT_PUBLIC_PRIVACY_EMAIL` (shown on legal pages only after inbound mail is working), and for metering/billing
`SUPABASE_SERVICE_ROLE_KEY` + `POLAR_ACCESS_TOKEN` + `POLAR_PRODUCT_ID` + `POLAR_WEBHOOK_SECRET`
(point the Polar webhook at `/api/billing/webhook`; without the secret the webhook fails closed).

**Live (verified 2026-07-13):** Vercel project `zhengbrodys-projects/postbeacon` → **https://postbeacon.app** + www.
Porkbun DNS: apex `A 76.76.21.21`, www `CNAME cname.vercel-dns.com` (nameservers stay on Porkbun).
Set in Vercel: OPENAI/DEEPSEEK keys; Claude is intentionally disabled. Supabase public configuration is enabled and the
production login gate is active. `SUPABASE_SERVICE_ROLE_KEY` is configured as a Sensitive,
Production-only secret; Preview has only the public Supabase URL/anon key. The original
seven-check schema/RLS/cascade audit is fully green in production: seven tables/RLS, six
owner policies, six auth-user cascades,
four workspace-parent cascades, closed webhook ledger and service-role-only transactional deletion
RPC all PASS. Billing remains unverified/off unless all Polar variables are set.
`NEXT_PUBLIC_PRIVACY_EMAIL=privacy@postbeacon.app` is live; Porkbun forwarding delivered an
external inbound test to the monitored founder mailbox. `DEFAULT_PROVIDER=openai`;
`NEXT_PUBLIC_DEEPSEEK_FALLBACK=true` allows a visibly disclosed DeepSeek retry during beta.
Inactive projects and webhook ids are retained for 30 days. `Pricing` is hidden during beta.
Event email code is deployed fail-closed but remains off until Resend/sender/public flag are
configured and verified; in-app reminders remain active.
Redeploy: `npx vercel --prod --yes`. Push env from `.env.local`: `~/push-env.sh`.

## Status / changelog
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
- **2026-07-12**: **M14 — behavior-preserving engineering cleanup** (no product changes).
  Audit first (deps clean — madge: no cycles; knip + grep for dead code), then: (1)
  ResultsView (865 lines) split into `components/app/results/` per-tab modules; ResultsView
  is a ~200-line orchestrator. (2) Plan state: 16 parallel useStates → pure
  `hooks/launchFlowReducer.ts` with normalize() enforcing invariants (fresh analyze /
  rebuilt strategy drop stale downstream state; selection ⊆ strategy channels; posted marks
  pruned with their posts; step clamped to data; PROJECT_LOADED resets the demo flag — each
  of these was a reachable contradictory-state bug before). Hook API unchanged; 12 invariant
  tests. (3) Dedup + typing: shared lib/plan.ts (rank order + calendar entry, was ×3),
  lib/async.ts mapLimit (was ×2), lib/coerce.ts unknown-coercers (was any-typed ×5 files);
  unified ApiErrorBody/ApiErrorCode across routes and client; app `any` 38 → 3 (llm.ts JSON
  seam, documented). (4) Persistence versioned: DRAFT_SCHEMA_VERSION=3, migrateDraft()
  chain (v1/v2/v3) + tests; Supabase meta carries the version. (5) Tooling: ESLint CLI flat
  config replaces deprecated `next lint`, Prettier (+repo-wide format), GitHub Actions CI.
  (6) /twitter-image build warning fixed (literal `runtime` export). Deleted:
  platformCatalogForStrategist (dead since M13); 15 unused exports de-exported; Pricing.tsx
  intentionally kept (beta gating). AGENTS.md fully synced (19 platforms, M7–M11 changelog
  restored, map matches real files). 185 offline tests + lint + format + build green;
  dashboard behavior re-verified in the browser.
- **2026-07-12**: **M13 — trust layer: facts / inference / recommendations separated.** Design doc:
  `docs/M13-trust-layer.md` (written first, incl. data-migration plan — no SQL change, all new
  data rides existing jsonb + localStorage; every new type field optional so old saves render).
  (1) **Fact Ledger** (`lib/facts.ts`): every claim carries status
  observed/user-confirmed/inferred/unknown + confidence + sourceUrl + lastVerifiedAt. Enforced in
  CODE: "observed" survives only when the model's evidence quote verifies against the scraped
  page (verifyFacts); fabricated quotes demote to inferred (confidence capped), model-emitted
  "user-confirmed" demotes, claims on unknowns are discarded. Users confirm/correct/delete via
  new `FactLedger` component; corrections sync the backing profile field. Ledger is partitioned
  into ESTABLISHED/INFERRED/UNKNOWN in every downstream prompt (strategy, generate, copilot).
  (2) **≤3 clarifying questions** (code-picked, never model): stage / conversionGoal / assets
  asked only when unknown or weakly inferred; answers → user-confirmed facts + new optional
  profile fields; skipping leaves an honest unknown (prompts told not to assume).
  (3) **Explainable scoring** (`lib/scoring.ts`): model rates audienceFit/intentFit/
  nativeContentFit/founderAccess/risk (0-10 + reason + factIds); effort comes from the catalog,
  evidenceQuality is computed from cited fact statuses; the 0-100 total = fixed weighted sum in
  code (weights exported), priority derived from thresholds. StrategyView shows the full
  per-dimension breakdown. (4) **19-platform guarantee**: zod-ish validation → dedupe → one
  scoped retry for missing/invalid ids → deterministic flagged fallbacks; unknown platform ids
  never invented. bestMove/venue get provenance: "grounded" ONLY when matching a validated live
  discovery (URLs never taken from the model); otherwise labeled "inferred" in the UI.
  (5) **Partial-success generation**: per-platform failures are caught → `failures[]` +
  ResultsView panel with per-channel retry (splices into content/calendar at rank); every output
  stamped with `meta {provider, model, promptVersion, generatedAt}` (PROMPT_VERSION consts in
  analysis/scoring/generate). (6) **Golden evals**: 12 product-type fixtures
  (`tests/golden/fixtures.ts`) + offline suites (faithfulness enforcement, completeness/repair,
  dedupe, grounding, banned-phrase lint via `lintVoice` — voice.ts now exports BANNED_PHRASES as
  the single source for both prompt and linter; demo content passes) + gated live eval
  (`RUN_LIVE_EVAL=1`) writing eval-results/report.md. **Live results (2026-07-12)**: deepseek —
  12/12 analyze ok, 100% name accuracy, 9% fabricated-evidence rate (7/81 caught+demoted), 96%
  unknown-honesty, scoring first-pass 114/114 complete with 0 dupes/0 fallbacks, 92% of drafts
  banned-phrase-free; openai (gpt-4o, subset) — 100% name accuracy but **58% fabricated-evidence
  rate** (15/26, all caught by enforcement), only 37% of recs cite ledger facts (deepseek: 96%);
  claude — HTTP 401, the ANTHROPIC_API_KEY in .env.local is invalid/expired (environment issue,
  not code; production runs DEFAULT_PROVIDER=deepseek). Venue grounding was 0 in this run because
  SEARCH_API_KEY is unset locally (mechanism covered by offline tests + demo). Demo rebuilt with
  the production assembly functions (facts incl. all statuses, 8 breakdowns, computed totals,
  grounded reddit/github chips). Gates green: typecheck ✓, 168 offline tests ✓, lint ✓, build ✓;
  verified in browser (demo breakdown/ledger UIs + real deepseek analyze of example.com →
  observed-with-quote vs inferred chips, 3 questions → answer → user-confirmed + question count
  drops). Known gap: demo has 8 hand-authored recommendations, not 19 (pre-M13 posture; real runs
  always return 19).
- **2026-07-11**: **M12 — P0 security hardening** (no product changes). (1) **SSRF**: new
  `lib/urlPolicy.ts` + `lib/safeFetch.ts` shared by scrape, discovery URL checks, and Firecrawl
  input — http/https+standard ports only; localhost/private/loopback/link-local/multicast/
  CGNAT/cloud-metadata/reserved IPv4 blocked and IPv6 allowlisted to global unicast; DNS
  validated inside the socket lookup (anti-rebinding); redirects re-validated per hop (max 3);
  response size/content-type/timeout caps; discovery drops non-public URLs; StrategyView only
  links `isSafeExternalHref` URLs. (2) **Runtime validation**: `lib/validate.ts` (zod) replaces
  every `as`-cast body across analyze/strategy/generate/regenerate/copilot — bounded strings/
  arrays/history, deduped catalog-checked platformIds, provider/action allowlists, 1MB body
  cap; `lib/errors.ts` PublicError so routes never leak internal error detail and validation
  errors never echo input. (3) **Polar**: webhook fails closed (503) without
  `POLAR_WEBHOOK_SECRET`; timestamp (±300s) + HMAC verification, webhook-id idempotency
  (`webhook_events` table), event-type allowlist + `POLAR_PRODUCT_ID` match + UUID user id
  (all in testable `lib/billing.ts`); checkout success_url from `SITE_URL` allowlist, Origin
  no longer trusted. (4) **Headers**: global CSP + nosniff/DENY/referrer/permissions/HSTS in
  next.config.mjs. (5) **Tooling**: vitest (133 tests), eslint, `typecheck`/`test` scripts.
  All four gates green; SSRF rejections, schema 400s, webhook 503, 413 cap, headers, and the
  live happy path (analyze incl. real redirect chain) verified against a running dev server.
- **2026-07-02**: **M11 — editable, focused, navigable** (founder feedback: plan not individually
  editable, too much content, one giant scroll). (1) **Focused generation**: default selection is
  now the **top-4 channels by score** (`defaultSelection` in useLaunchFlow, replaces "all non-low");
  StrategyView states the contract ("content only for checked channels") + a live post estimate;
  `selected` is persisted (localStorage draft field / new `projects.meta` jsonb, which also fixes
  signed-in `launchDate` never being saved). Restore chain `p.selected ?? p.meta?.selected ??
  defaultSelection(...)` keeps all pre-M11 saves working. (2) **Tabbed dashboard**: ResultsView
  rebuilt as 4 tabs (Overview / Content / Calendar / Execute) via new `components/ui/Tabs.tsx`;
  only the active tab mounts. Content is master-detail: ranked channel list (score, priority,
  posted progress) → one channel's playbook+posts; anchor-nav + "channels, ranked" section removed
  as dead code. Print/Cmd+P force-mounts everything via `beforeprint` + `flushSync` (all tabs, all
  channels), `print:block` on the grid so the hidden sidebar doesn't squeeze the paper layout.
  (3) **Editable plan**: PositioningCard gains optional `onUpdate` (exec summary + positioning,
  results step only); per-channel angle/bestMove editable in the channel header
  (`updateRecommendation`); calendar rows edit (commit-on-Done, re-sorts by day) / delete / add
  custom step; channels removable post-generation (inline two-step confirm; prunes content,
  schedule, posted marks, selection together) and addable from the ranked list (`addChannel` via
  /api/regenerate, splices at ranked position + calendar entry; hidden in demo). New hook actions:
  updateStrategy, updateRecommendation, updateScheduleItem, removeScheduleItem, addScheduleItem,
  removeChannel, addChannel — all pure state, so autosave/export/Copilot pick edits up for free.
  Build green; verified in browser on the demo plan (tabs, master-detail, edits, add/remove
  channel + calendar cascade, beforeprint force-mount, top-4 preselect fallback for legacy saves).
- **2026-07-01**: **M10 — Contextual Launch Copilot.** A CMO assistant scoped to the CURRENT plan
  (not a generic chatbot), on the results dashboard. New `lib/copilot.ts` (`runCopilot`): compact
  plain-text plan snapshot (profile/strategy/calendar + posts tagged `[platformId #idx]`, 28k-char
  cap, type-guarded against malformed request JSON) + 7 actions (`explain-plan`, `next-steps`,
  `improve-posts`, `rewrite`, `first-replies`, `review-feedback`, `ask`) with anti-generic system
  rules ("point at concrete plan elements by name; no advice that'd fit another product; never
  invent facts — leave [fill in] placeholders"); rewrite-type actions inject platform
  guidance/persona + ANTI_AI_RULES. New `POST /api/copilot` (guardRoute → login+daily cap for free;
  maxDuration 120; per-action 400 validation). New `components/app/CopilotPanel.tsx`: floating
  "✦ Ask your CMO" → right drawer (fixed+no-print, Esc/scrim close), quick-action chips, platform
  select for Rewrite/First replies, "pasting feedback" toggle, transcript in component state ONLY
  (session-scoped by design), per-reply Copy, rewrite cards with Copy + **Apply to draft** →
  `updatePost` (old hook auto-becomes A/B variant; autosave picks it up). Mounted in `AppFlow`
  next to Paywall; 401 → existing sign-in Paywall. History = last 6 turns, sent per request.
  Also: **prompt hardening** (voice.ts banned-phrase additions incl. "Say goodbye to"/"delve"/
  "Introducing" opener; generate.ts competitor test; strategy bestMove must name the exact venue;
  analyze never fabricates on thin pages), **Copy all posts** button on Content library
  (`postsToMarkdown` in export.ts, shared `appendPosts` with toMarkdown), and "20+" → "19+"
  platform-count fix (metadata/OG/Pricing/README — catalog has 19). Build green; all 7 actions
  verified live (deepseek) incl. multi-turn history, Apply-to-draft, and 401 semantics.
- **2026-06-25**: **M9 — login gate + Google OAuth.** `/app` now requires sign-in **when Supabase is
  configured** (degrades to fully open when it isn't, so local dev + the demo still work; `?demo=1`
  always bypasses the gate). New `components/app/AuthScreen.tsx` (Continue-with-Google primary +
  magic-link fallback + "see example" escape). `SignIn.tsx` gained `loading` on `useSupabaseUser`
  (drives a no-flash gate via `onAuthStateChange`'s initial session), `signInWithGoogle()`, and a
  reusable `GoogleButton`. `app/app/page.tsx` split into `AppPage` (gate) + `AppFlow` (the tool).
  Google sign-in uses `supabase.auth.signInWithOAuth({provider:'google', redirectTo:'/app'})` — works
  with the client's existing `detectSessionInUrl`, no callback route needed. **Activation needs config
  (not code):** Supabase URL+anon keys, Google provider enabled in Supabase, a Google Cloud OAuth
  client, and the redirect URLs whitelisted. Build green; gate UI verified in browser. (Server-side
  hardening of /api/analyze+/api/strategy is still optional — generate/regenerate already gate on
  metering.)
- **2026-06-25**: **M8 — beta-launch polish (public GitHub-ready).** (1) **Demo mode**: new
  `lib/demo.ts` ships a hand-authored, anti-AI full example plan ("Cronwise"); `useLaunchFlow`
  gained `demo`/`loadDemo`, a `?demo=1` deep link, and an "or see a full example plan" entry on the
  URL step + a no-key prompt. Autosave is gated on `demo` so the example never overwrites a real
  draft. Lets anyone (incl. GitHub visitors with no API key) explore the whole dashboard for free.
  (2) **Beta feedback CTA**: `components/app/FeedbackCTA.tsx` (shown on results) + `lib/site.ts`
  (`REPO_URL`/`FEEDBACK_URL`, defaults to GitHub issues). (3) **LLM robustness**: `lib/llm.ts`
  now slices+repairs JSON and does one model **repair retry** on parse failure (fixes the
  unescaped-inner-quote crash from the bigger M7 strategy schema); added a JSON guard to prompts.
  (4) Founder-voice **README** rewrite + **LICENSE** (MIT) + landing hero/demo-link alignment.
  Build green; demo verified end-to-end in browser.
- **2026-06-24**: **M7 — AI-CMO operating system.** Upgraded from "content generator" to a full 0→1
  launch plan, distributed across the existing 3 LLM calls (no new endpoints, keeps JSON reliable):
  • **analyze** now forms a business *diagnosis* (`whatItIs`/`whyCare`/`useCase`/`confidence`).
  • **strategy** is the full CMO plan: `executiveSummary`, `positioning`+`antiPositioning`,
    `audienceSegments` (primary/secondary/early), `coldStart`+GTM `phases`, `founderChecklist`,
    `risks`, `iterationLoop`, plus ranked channels enriched with `effort`/`confidence`/`bestMove`
    (maxTokens 4000→8000). • **generate** emits a per-platform `playbook`
    (whyThisPlatform/howToPost/whatToAvoid/firstReplies/postingWindow) alongside posts.
  Anti-AI writing: new `lib/voice.ts` `ANTI_AI_RULES` + per-platform `persona` (HN restrained,
  Reddit community-member, X hook-not-hype, LinkedIn earned-not-performed, PH maker-not-PR) with a
  silent "would a native smell marketing?" self-check. UI: Stepper relabel (Analyze/Diagnose/
  Strategy/Launch plan); Diagnosis read-out on the profile step; richer StrategyView; Results is now
  a sectioned **operating dashboard** (Summary·Audience·Channels·Plan·Calendar·Content·Checklist·
  Risks·Iterate) via new `components/app/PlanSummary.tsx` + per-channel playbook panels. All new
  types optional in `lib/types.ts` (saved projects stay compatible); export.ts + autosave carry the
  new fields for free. Build green.
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
