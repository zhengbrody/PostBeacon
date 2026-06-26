# CLAUDE.md — PostBeacon

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
    billing/{checkout,webhook}/route.ts                              Polar checkout + webhook
lib/
  types.ts              All shared types (Provider, ProductProfile, MarketingStrategy, ...)
  platforms.ts          THE platform universe (catalog + per-platform voice rules). Most-tuned file.
  llm.ts                Claude/OpenAI abstraction → generateJson()
  generate.ts           Per-platform content+playbook prompt (generatePlatformPosts) — shared by generate+regenerate
  voice.ts              ANTI_AI_RULES — house rules injected into content prompts to kill AI tells
  demo.ts               DEMO_PROJECT — a hand-authored full example plan (the no-API-key showcase)
  site.ts               Public config (REPO_URL, FEEDBACK_URL) — NEXT_PUBLIC_* overridable
  export.ts             Launch plan → Markdown / JSON; downloadFile helper
  dates.ts              scheduleDate(launchDate, day) for the calendar
  auth.ts               bearer(req) — read the Supabase token from a request
  usage.ts              Entitlement read/increment + FREE_LAUNCHES (server metering)
  scrape.ts             Landing-page fetch + extract (static → render fallback)
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
  ui/                   Button, Card, Badge, Spinner, Field (design system primitives)
  app/                  Stepper, UrlStep, ProfileForm, StrategyView, ResultsView (operating dashboard),
                        PlanSummary (shared plan-section cards), ProjectBar, SignIn, Paywall, UsageBadge
  landing/              Nav, Hero, HowItWorks, PlatformShowcase, Pricing, FAQ, Footer
supabase/schema.sql     projects table + row-level security
```

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
npm run build            # must stay green
```

## Deploy (Vercel)
Import repo → set env (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`) → point `postbeacon.app` DNS at Vercel. Accounts need
`supabase/schema.sql` run once in the Supabase SQL editor.

Optional env (each degrades gracefully if unset): `SCRAPE_API_KEY` (Firecrawl, SPA scraping),
`SEARCH_API_KEY` (Tavily, grounded discovery), and for metering/billing
`SUPABASE_SERVICE_ROLE_KEY` + `POLAR_ACCESS_TOKEN` + `POLAR_PRODUCT_ID` + `POLAR_WEBHOOK_SECRET`
(point the Polar webhook at `/api/billing/webhook`).

**Live (2026-06-24):** Vercel project `zhengbrodys-projects/postbeacon` → **https://postbeacon.app** + www.
Porkbun DNS: apex `A 76.76.21.21`, www `CNAME cname.vercel-dns.com` (nameservers stay on Porkbun).
Set in Vercel: ANTHROPIC/OPENAI/DEEPSEEK keys + `DEFAULT_PROVIDER=deepseek`. Supabase & billing
left unset → accounts off (anon + localStorage), generation open/unmetered, `Pricing` hidden (beta).
Redeploy: `npx vercel --prod --yes`. Push env from `.env.local`: `~/push-env.sh`.

## Status / changelog
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
