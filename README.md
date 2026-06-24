# PostBeacon

**Paste a URL → your AI CMO scans every platform, tells you where to go all-in, and writes ready-to-post content + a launch calendar.** Built for vibecoders launching to the (English) developer/startup community.

No auto-posting — content is copy-paste ready (keeps you off every platform's ban radar).

> Architecture & conventions live in [`CLAUDE.md`](./CLAUDE.md).

## The flow
```
URL → ① scrape + LLM profile → ② review profile → ③ STRATEGIST scans 20+ platforms,
       scores & ranks them for YOUR product → ④ generate native content + calendar
```
Marketing landing page is at `/`; the tool is at `/app`.

## Stack
- Next.js (App Router) + Tailwind v4 → deploy to Vercel
- Pluggable LLM: Claude (Anthropic) **or** OpenAI, switchable per request (`lib/llm.ts`)
- `cheerio` for landing-page scraping
- **Supabase** for accounts + saved projects (optional — app runs without it)

## Run locally
```bash
npm install
cp .env.example .env     # add ANTHROPIC_API_KEY and/or OPENAI_API_KEY
npm run dev              # http://localhost:3000
```
At least one model key is required. Supabase keys are optional.

## Enable accounts + saved projects (Supabase)
1. Create a free Supabase project.
2. Run `supabase/schema.sql` in the SQL editor (creates the `projects` table + row-level security).
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to `.env`.
4. Restart. The app header now has magic-link sign-in, **Save project**, and your project list.

Without these keys, the app still works end-to-end — it just can't save.

## Deploy
Push to GitHub → import in Vercel → add the same env vars → point `postbeacon.app` DNS at Vercel.

## Roadmap
- **Phase 2 — live discovery**: `lib/discovery.ts` already wires `strategy.discoveries` into the UI. Plug a search API (Brave/SerpAPI/Tavily) to surface niche subreddits, Discord/Slack communities, "awesome-X" lists, and where competitors are discussed.
- Chinese platforms (小红书/即刻/V2EX/掘金/B站) as a second universe.
- Effect tracking (paste back results), team collab, paywall.
