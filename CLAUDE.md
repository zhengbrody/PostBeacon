# CLAUDE.md — PostBeacon

> Living architecture + status doc. Keep this updated as the project evolves.

## What PostBeacon is
An AI-CMO SaaS for vibecoders. Paste a product URL → PostBeacon scrapes the page,
distills a product profile, scans 19+ platforms and **scores/ranks** them for that
specific product, then generates **ready-to-post** native content + a launch calendar.
**No auto-posting** by design (copy-paste keeps users off platform ban radar).

- Brand: **PostBeacon**, domain **postbeacon.app** (owned). `postbeacon.com` was also
  free at selection time if a `.com` is wanted later. (Renamed from earlier "PostPilot",
  which collided with an existing marketing company.)

## Stack
Next.js 15 (App Router) · React 19 · Tailwind v4 · TypeScript (strict) ·
Claude/OpenAI (switchable) · Supabase (optional accounts) · cheerio (scraping). Deploys to Vercel.

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
  app/page.tsx          The tool — thin; wires useLaunchFlow to components/app/*
  api/
    analyze|strategy|generate|regenerate|providers|usage/route.ts   server endpoints
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
  generate.ts           Per-platform content+playbook prompt (generatePlatformPosts) — shared by generate+regenerate
  copilot.ts            Launch Copilot: compact plan-context builder + per-action prompts (runCopilot)
  voice.ts              ANTI_AI_RULES — house rules injected into content prompts to kill AI tells
  demo.ts               DEMO_PROJECT — a hand-authored full example plan (the no-API-key showcase)
  site.ts               Public config (REPO_URL, FEEDBACK_URL) — NEXT_PUBLIC_* overridable
  export.ts             Launch plan → Markdown / JSON; downloadFile helper
  dates.ts              scheduleDate(launchDate, day) for the calendar
  auth.ts               bearer(req) — read the Supabase token from a request
  usage.ts              Entitlement read/increment + FREE_LAUNCHES (server metering)
  plan.ts               Shared plan shaping: rank ordering, canonical calendar entries (M14)
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
  app/                  Stepper, UrlStep, ProfileForm, FactLedger, StrategyView, ResultsView
                        (tab orchestrator), PlanSummary (shared plan-section cards),
                        CopilotPanel (Launch Copilot drawer), ProjectBar, SignIn, AuthScreen,
                        Paywall, UsageBadge, FeedbackCTA
  app/results/          The results dashboard, one module per tab (M14): OverviewTab,
                        ContentTab (master-detail) + ChannelBlock + PostCard, CalendarTab,
                        ExecuteTab, FailuresCard, PrintHeading
  landing/              Nav, Hero, HowItWorks, PlatformShowcase, Pricing, FAQ, Footer
docs/M13-trust-layer.md Design + migration doc for the trust layer (facts/scoring/partial success)
tests/                  vitest suites: urlPolicy, safeFetch, billing, webhook route, validate,
                        golden (12-fixture offline evals), generateRoute, flowReducer
                        (state-machine invariants), storage (draft migrations); eval.live (gated)
tests/golden/           fixtures.ts — 12 product-type golden fixtures with ground truth
supabase/schema.sql     projects (+ meta jsonb) + entitlements + webhook_events, row-level security
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
post-checkout redirect; defaults to https://postbeacon.app), and for metering/billing
`SUPABASE_SERVICE_ROLE_KEY` + `POLAR_ACCESS_TOKEN` + `POLAR_PRODUCT_ID` + `POLAR_WEBHOOK_SECRET`
(point the Polar webhook at `/api/billing/webhook`; without the secret the webhook fails closed).

**Live (2026-06-24):** Vercel project `zhengbrodys-projects/postbeacon` → **https://postbeacon.app** + www.
Porkbun DNS: apex `A 76.76.21.21`, www `CNAME cname.vercel-dns.com` (nameservers stay on Porkbun).
Set in Vercel: ANTHROPIC/OPENAI/DEEPSEEK keys + `DEFAULT_PROVIDER=deepseek`. Supabase & billing
left unset → accounts off (anon + localStorage), generation open/unmetered, `Pricing` hidden (beta).
Redeploy: `npx vercel --prod --yes`. Push env from `.env.local`: `~/push-env.sh`.

## Status / changelog
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
