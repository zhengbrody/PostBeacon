<div align="center">

# PostBeacon

### Your AI CMO. Paste a product URL, get a complete 0→1 launch plan.

PostBeacon reads your landing page, forms a real point of view on what you're selling and who should
care, scores 20+ channels for *your* product, and hands you a founder-grade go-to-market plan —
including ready-to-post content written to **not** sound like AI.

No auto-posting. Everything is copy-paste ready, by design — which keeps you off every platform's
ban radar.

[Live → postbeacon.app](https://postbeacon.app) · [Architecture & conventions → CLAUDE.md](./CLAUDE.md)

</div>

---

## What you get

Paste one URL and PostBeacon returns a single operating plan, not a pile of disconnected posts:

| Section | What's in it |
| --- | --- |
| **Diagnosis** | What the product *actually* is, why anyone cares, the moment it's used — with a confidence flag when the page is thin. |
| **Positioning** | The one narrative to lead with everywhere, plus an **anti-positioning** ("don't say it like this") to avoid. |
| **Audience** | Primary / secondary / early-adopter segments, and where each already hangs out. |
| **Channel ranking** | All 20+ platforms scored 0–100 for *your* product, with effort, confidence, rationale, and the single best move per channel. |
| **GTM plan** | A cold-start path (0 → first users) and a sequenced, phased 14/30-day plan. |
| **Content library** | Native, copy-paste-ready posts per channel — with a per-platform playbook (why this platform, how to post, what to avoid, and the first replies to seed the thread). |
| **Launch calendar** | A dated action sequence from a launch-day picker. |
| **Founder checklist** | What the founder personally does, by cadence. |
| **Risks & iteration** | Where launches go sideways (and how to dodge it), plus what to measure after posting and how to react. |

Export the whole thing to **Markdown / JSON**, or print to PDF.

## Content that doesn't read like AI

The fastest way to get ignored — or flagged — on Hacker News, Reddit, and Lobsters is to sound like a
marketing bot. PostBeacon ships a house style (`lib/voice.ts`) that bans the usual tells
("game-changer", triadic cadence, em-dash summaries, emoji spam) and writes in a **per-platform
persona** instead:

- **Hacker News** — restrained, technically honest, limitations up front.
- **Reddit** — a community member who happens to have built something, not a marketer.
- **X / Twitter** — a strong hook without the hustle-bro energy.
- **LinkedIn** — earned, not performed; no broetry.
- **Product Hunt** — a maker sharing the real itch, not a company doing PR.

Every piece passes a silent *"would a skeptical regular of this platform smell marketing?"* check
before it's returned.

## How it works

```
URL ─▶ /api/analyze   ─▶ ProductProfile      scrape + LLM diagnosis (what it is, why care)
       /api/strategy  ─▶ MarketingStrategy   score & rank ALL channels + the full CMO plan
       /api/generate  ─▶ GenerateResult      native content + per-platform playbook + calendar
```

The frontend drives this as a 4-step flow — **Analyze → Diagnose → Strategy → Launch plan** — at
`/app`. The marketing landing page is at `/`.

## Stack

- **Next.js 15** (App Router) · **React 19** · **TypeScript** (strict) · **Tailwind v4**
- Pluggable LLM, switchable per request (`lib/llm.ts`): **Claude** (Anthropic), **OpenAI**, or **DeepSeek**
- `cheerio` for scraping, with a headless render fallback for SPA pages
- **Supabase** (optional) for accounts + saved projects
- Deploys to **Vercel**

## Run locally

```bash
npm install
cp .env.example .env     # add ANTHROPIC_API_KEY and/or OPENAI_API_KEY (or DEEPSEEK_API_KEY)
npm run dev              # http://localhost:3000
```

At least one model key is required; everything else is optional. `npm run build` must stay green.

## Optional configuration

Each of these degrades gracefully if its key is unset — the app always runs end-to-end without them.

| Env | Enables |
| --- | --- |
| `DEFAULT_PROVIDER` | Pins which model the UI selects first (`claude` / `openai` / `deepseek`). |
| `SCRAPE_API_KEY` | Headless rendering (Firecrawl) for client-rendered SPA landing pages. |
| `SEARCH_API_KEY` | Grounded niche-channel discovery (Tavily) — real, link-checked communities. |
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Magic-link sign-in, autosave, saved projects. Run `supabase/schema.sql` once. |
| `SUPABASE_SERVICE_ROLE_KEY` + `POLAR_*` | Server-side usage metering + Polar checkout/webhook billing. |

## Deploy

Push to GitHub → import in Vercel → add the same env vars → point `postbeacon.app` DNS at Vercel.
Accounts need `supabase/schema.sql` run once in the Supabase SQL editor.

## Roadmap

- **Effect tracking** — paste results back in to learn which angles and channels actually landed.
- **A second platform universe** — Chinese channels (小红书 / 即刻 / V2EX / 掘金 / B站).
- **Team collaboration** on a shared launch plan.
