# AGENTS.md — PostBeacon

> Living architecture + status doc. Keep this updated as the project evolves.

## What PostBeacon is
An AI-CMO SaaS for vibecoders. Paste a product URL → PostBeacon scrapes the page,
distills a product profile, scans 20+ platforms and **scores/ranks** them for that
specific product, then generates **ready-to-post** native content + a launch calendar.
**No auto-posting** by design (copy-paste keeps users off platform ban radar).

- Brand: **PostBeacon**, domain **postbeacon.app** (owned). `postbeacon.com` was also
  free at selection time if a `.com` is wanted later. (Renamed from earlier "PostPilot",
  which collided with an existing marketing company.)

## Stack
Next.js 15 (App Router) · React 19 · Tailwind v4 · TypeScript (strict) ·
Claude/OpenAI (switchable) · Supabase (optional accounts) · cheerio + Firecrawl (scraping). Deploys to Vercel.

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
  generate.ts           Per-platform content prompt (generatePlatformPosts) — shared by generate+regenerate
  copilot.ts            Launch Copilot: compact plan-context builder + per-action prompts (runCopilot)
  voice.ts              ANTI_AI_RULES — house rules injected into content prompts to kill AI tells
  demo.ts               DEMO_PROJECT — hand-authored full example plan (the no-API-key showcase)
  site.ts               Public config (REPO_URL, FEEDBACK_URL) — NEXT_PUBLIC_* overridable
  export.ts             Launch plan → Markdown / JSON; downloadFile helper
  dates.ts              scheduleDate(launchDate, day) for the calendar
  auth.ts               bearer(req) — read the Supabase token from a request
  usage.ts              Entitlement read/increment + FREE_LAUNCHES + daily cap (server metering)
  errors.ts             PublicError/BlockedUrlError — the only error messages routes may expose
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
  storage.ts            localStorage "current draft" (anonymous autosave slot)
  supabase/client.ts    Browser Supabase client (graceful if unconfigured)
  supabase/server.ts    Service-role client (server-only; trust-counts usage)
hooks/
  useLaunchFlow.ts      The 4-step state machine + actions + project load/restore + draft hydrate
  useAutosave.ts        Debounced persist: localStorage (anon) / Supabase upsert (signed-in)
components/
  ui/                   Button, Card, Badge, Spinner, Field, Tabs (design system primitives)
  app/                  Stepper, UrlStep, ProfileForm, FactLedger (provenance UI + questions),
                        StrategyView (score breakdowns), ResultsView (failures panel + retry),
                        PlanSummary, CopilotPanel, ProjectBar, SignIn, AuthScreen, Paywall,
                        UsageBadge, FeedbackCTA
  landing/              Nav, Hero, HowItWorks, PlatformShowcase, Pricing, FAQ, Footer
docs/M13-trust-layer.md Design + migration doc for the trust layer (facts/scoring/partial success)
tests/                  vitest suites: urlPolicy, safeFetch, billing, webhook route, validate,
                        golden (12-fixture offline evals), generateRoute; eval.live (gated)
tests/golden/           fixtures.ts — 12 product-type golden fixtures with ground truth
supabase/schema.sql     projects + entitlements + webhook_events tables, row-level security
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
- LLM calls go through `lib/llm.ts`; browser calls through `lib/api.ts`.

## Run
```bash
npm install
cp .env.example .env     # ANTHROPIC_API_KEY and/or OPENAI_API_KEY (Supabase keys optional)
npm run dev              # landing at /, tool at /app
npm run typecheck        # tsc --noEmit
npm test                 # vitest (security + golden suites in tests/; offline, no API keys)
npm run lint             # next lint (eslint-config-next)
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
