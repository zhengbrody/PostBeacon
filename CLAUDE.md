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
  app/page.tsx          The tool — thin; wires useLaunchFlow to components/app/*
  api/
    analyze|strategy|generate|providers/route.ts   server endpoints
lib/
  types.ts              All shared types (Provider, ProductProfile, MarketingStrategy, ...)
  platforms.ts          THE platform universe (catalog + per-platform voice rules). Most-tuned file.
  llm.ts                Claude/OpenAI abstraction → generateJson()
  scrape.ts             Landing-page fetch + extract
  discovery.ts          PHASE 2 live web discovery (stub; gated on SEARCH_API_KEY)
  api.ts                Browser→server typed client (used by the hook)
  supabase/client.ts    Browser Supabase client (graceful if unconfigured)
hooks/
  useLaunchFlow.ts      The 4-step state machine + actions + project load/restore
components/
  ui/                   Button, Card, Badge, Spinner, Field (design system primitives)
  app/                  Stepper, UrlStep, ProfileForm, StrategyView, ResultsView, ProjectBar
  landing/              Nav, Hero, HowItWorks, PlatformShowcase, FAQ, Footer
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

## Status / changelog
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

## Roadmap
- Phase 2: implement `lib/discovery.ts` (search API → niche subreddits/Discords/awesome-lists).
- Chinese platform universe (小红书/即刻/V2EX/掘金/B站).
- Persist posted-status & autosave; effect tracking; paywall; OG image asset.
