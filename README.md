# PostBeacon

**Paste your product URL. Get a launch plan you can actually run today.**

I built PostBeacon because I can ship a product in a weekend and then completely stall on the part that decides whether anyone sees it. Writing the Show HN, picking the right subreddits, figuring out the order to post things in, making the copy not sound like a press release — that work is real, and "use AI to write a tweet" doesn't cover it.

So this isn't a caption generator. You give it a URL; it reads the page, works out what the product actually is and who'd care, scores 19+ channels for *that* product, and hands back a full go-to-market plan — positioning, audience, a phased calendar, a founder checklist, and copy-paste content written to read like a person, not a model.

**It never posts for you.** Everything is copy-paste, on purpose — you stay in control, and you stay off every platform's automation ban radar.

→ **[See a full example plan](https://postbeacon.app/app?demo=1)** (no signup, no API key — it's a real, complete plan for a sample product)

---

## What it gives you

One URL in, one operating plan out:

- **Diagnosis** — what the product really is, why anyone cares, the moment they reach for it
- **Positioning** — the line to lead with everywhere, plus the framing to *avoid*
- **Audience** — primary / secondary / early-adopter, and where each already hangs out
- **Channel ranking** — every platform scored 0–100 for *your* product, with effort, rationale, and the one best move per channel
- **GTM plan** — a cold-start path and a sequenced 14/30-day calendar
- **Content library** — native, ready-to-post drafts per channel, each with a playbook: why this platform, how to post, what gets you flagged, and the first replies to seed the thread
- **Founder checklist + risks + iteration loop** — what to do, what'll go sideways, and what to measure after

Export the whole thing to Markdown / JSON or print to PDF.

## Why it doesn't read like AI

The fastest way to get buried on Hacker News, Reddit, or Lobsters is to sound like marketing. PostBeacon ships a house style (`lib/voice.ts`) that bans the usual tells — "game-changer," triadic cadence, "I'm excited to announce," emoji spam — and writes in a per-platform voice instead:

- **Hacker News** — restrained, technically honest, limitations stated up front
- **Reddit** — a community member who happens to have built something, not a vendor
- **X** — a real hook without the hustle-bro energy
- **LinkedIn** — earned, not performed
- **Product Hunt** — a maker sharing the actual itch, not a company doing PR

Every draft passes a silent "would a regular here smell marketing?" check before it comes back.

## How it works

```
URL ─▶ /api/analyze   ─▶ diagnosis: what it is, who cares
       /api/strategy  ─▶ score & rank every channel + the full CMO plan
       /api/generate  ─▶ native content + per-platform playbook + calendar
```

Four steps in the app — **Analyze → Diagnose → Strategy → Launch plan** — at `/app`.

## Run it locally

```bash
npm install
cp .env.example .env     # add one model key (see below)
npm run dev              # http://localhost:3000
```

You need **at least one** of these in `.env`:

```
ANTHROPIC_API_KEY=...     # Claude
OPENAI_API_KEY=...        # OpenAI
DEEPSEEK_API_KEY=...      # DeepSeek (cheapest to run)
# DEFAULT_PROVIDER=deepseek   # optional: which one the UI picks first
```

No key handy? The app still runs — open `/app?demo=1` for the full example plan.

Everything else is optional and degrades gracefully:

| Env | Turns on |
| --- | --- |
| `SCRAPE_API_KEY` | Headless rendering (Firecrawl) for client-rendered SPA pages |
| `SEARCH_API_KEY` | Grounded, link-checked niche-channel discovery (Tavily) |
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sign-in, autosave, saved projects (run `supabase/schema.sql` once) |
| `SUPABASE_SERVICE_ROLE_KEY` + `POLAR_*` | Usage metering + checkout |
| `NEXT_PUBLIC_FEEDBACK_URL` | Where the in-app "Send feedback" points (defaults to GitHub issues) |

## Deploy

Push to GitHub → import in Vercel → add the same env vars → point your domain at Vercel. `npm run build` is the bar; it stays green.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 · pluggable LLM (`lib/llm.ts`) · `cheerio` scraping · optional Supabase. No heavy framework on top.

## Roadmap

- **Effect tracking** — paste results back in to learn which angles and channels actually converted
- **A second platform universe** — Chinese channels (小红书 / 即刻 / V2EX / 掘金 / B站)
- **Shared projects** for small teams

## It's in beta — tell me what's wrong

I'd rather hear "the Reddit post still sounds like an ad" than nothing. If a plan is off, the copy misses, or a channel score seems wrong, [open an issue](https://github.com/zhengbrody/PostBeacon/issues) — that feedback is what shapes what ships next.

## License

[MIT](./LICENSE).
