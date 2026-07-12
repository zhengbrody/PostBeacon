/**
 * Golden evaluation fixtures: 12 hand-written products across distinct
 * product types. Each fixture is a synthetic scraped landing page plus ground
 * truth about what the page DOES and DOES NOT state — that's what lets the
 * evals measure fact-faithfulness and unknown-honesty automatically.
 *
 * Used by both the offline suites (tests/golden.test.ts — no network) and the
 * live provider eval (tests/eval.live.test.ts).
 */

export interface GoldenFixture {
  id: string;
  productType: string;
  page: {
    url: string;
    title: string;
    description: string;
    headings: string[];
    text: string;
  };
  truth: {
    /** The product's real name (live eval: analyze must land on it). */
    name: string;
    /** Verbatim snippets that ARE on the page (valid evidence candidates). */
    onPage: string[];
    /** Does the page state these launch-context facts? (false → an honest
     *  model must mark the fact unknown, not invent it.) */
    states: { stage: boolean; conversionGoal: boolean; assets: boolean };
  };
}

export const FIXTURES: GoldenFixture[] = [
  {
    id: "dev-cli",
    productType: "developer CLI tool",
    page: {
      url: "https://envsync.dev",
      title: "envsync — keep .env files in sync across your team",
      description:
        "A CLI that encrypts and syncs environment variables so onboarding takes one command.",
      headings: [
        "Stop pasting .env files into Slack",
        "One command to onboard",
        "End-to-end encrypted",
        "Pricing",
      ],
      text: "Stop pasting .env files into Slack. envsync keeps environment variables encrypted in your repo and in sync across your team. New teammate? They run envsync pull and have a working local setup in under a minute. Secrets are encrypted with age before they ever leave the machine, and every change is versioned next to your code. Works with Node, Python, Go, and anything that reads a .env file. Install with a single brew or curl command. Free for solo developers. Team plan is $6 per seat per month. envsync pull. envsync push. That's the whole workflow.",
    },
    truth: {
      name: "envsync",
      onPage: [
        "Stop pasting .env files into Slack",
        "encrypted with age before they ever leave the machine",
        "Free for solo developers",
        "$6 per seat per month",
      ],
      states: { stage: false, conversionGoal: false, assets: false },
    },
  },
  {
    id: "b2b-saas",
    productType: "B2B SaaS",
    page: {
      url: "https://ledgerline.app",
      title: "Ledgerline — invoicing that chases late payers for you",
      description:
        "Invoicing for small agencies: automatic reminders, late fees, and a cash-flow view.",
      headings: [
        "Get paid without the awkward emails",
        "Automatic reminder sequences",
        "Start your 14-day free trial",
      ],
      text: "Get paid without the awkward emails. Ledgerline sends your invoices, then follows up with polite, escalating reminders until they're paid — you never write another chasing email. Set late fees once and they're applied automatically. The cash-flow view shows what's owed, what's late, and what's projected for the next 60 days. Built for agencies and studios with 2 to 20 people. Connects to Stripe and your bank. Start your 14-day free trial — no credit card required. Plans from $19/month after the trial.",
    },
    truth: {
      name: "Ledgerline",
      onPage: [
        "polite, escalating reminders until they're paid",
        "Built for agencies and studios with 2 to 20 people",
        "Start your 14-day free trial",
        "Plans from $19/month",
      ],
      states: { stage: false, conversionGoal: true, assets: false },
    },
  },
  {
    id: "consumer-mobile",
    productType: "consumer mobile app",
    page: {
      url: "https://sipwell.app",
      title: "Sipwell — the water reminder that adapts to your day",
      description:
        "An iOS app that nudges you to drink based on weather, activity, and your actual schedule.",
      headings: [
        "Hydration that fits your life",
        "Smart, not naggy",
        "Download on the App Store",
      ],
      text: "Hydration that fits your life. Sipwell reads your calendar, the weather, and your workout data to time reminders when you can actually act on them — not during your 2pm meeting. Log a glass with one tap or from the widget. Streaks, gentle goals, and a weekly report that shows patterns you didn't notice. No account required, your data stays on your phone. Free to download on the App Store, with a one-time $12 unlock for the adaptive engine. Featured in the App Store's Health picks.",
    },
    truth: {
      name: "Sipwell",
      onPage: [
        "reads your calendar, the weather, and your workout data",
        "No account required, your data stays on your phone",
        "one-time $12 unlock",
        "Featured in the App Store's Health picks",
      ],
      states: { stage: false, conversionGoal: true, assets: true },
    },
  },
  {
    id: "ai-writer",
    productType: "AI writing tool",
    page: {
      url: "https://drafthorse.ai",
      title: "Drafthorse — cold emails that sound like you wrote them",
      description:
        "An AI email writer trained on your sent folder so outreach keeps your voice.",
      headings: [
        "Outreach in your voice",
        "Trained on your sent mail",
        "Join the waitlist",
      ],
      text: "Outreach in your voice. Drafthorse learns from the emails you've already sent — your phrasing, your sign-offs, your level of formality — and drafts cold outreach that reads like you on a good day. Paste a prospect's LinkedIn or website and get a first draft in seconds, with every claim pulled from the page you gave it. Edits teach it. Nothing is sent automatically; you approve every email. We're onboarding in small batches — join the waitlist and we'll email you when your spot opens.",
    },
    truth: {
      name: "Drafthorse",
      onPage: [
        "learns from the emails you've already sent",
        "Nothing is sent automatically; you approve every email",
        "join the waitlist",
        "onboarding in small batches",
      ],
      states: { stage: true, conversionGoal: true, assets: false },
    },
  },
  {
    id: "ecommerce",
    productType: "e-commerce physical product",
    page: {
      url: "https://loamly.co",
      title: "Loamly — the planter that waters itself for six weeks",
      description:
        "A ceramic self-watering planter with a six-week reservoir and a soil-moisture window.",
      headings: [
        "Plants that survive your schedule",
        "Six weeks per fill",
        "Free shipping over $60",
      ],
      text: "Plants that survive your schedule. Loamly's ceramic reservoir waters your plant from below for up to six weeks per fill, and the soil-moisture window tells you exactly when to top up. No batteries, no app, no drowned roots. Each planter is slip-cast stoneware, available in three sizes and four glazes. $38 for the small, $52 medium, $74 large. Free shipping in the US over $60. 30-day returns, no questions. As seen in Apartment Therapy's spring roundup.",
    },
    truth: {
      name: "Loamly",
      onPage: [
        "waters your plant from below for up to six weeks",
        "No batteries, no app, no drowned roots",
        "$38 for the small",
        "As seen in Apartment Therapy's spring roundup",
      ],
      states: { stage: false, conversionGoal: false, assets: true },
    },
  },
  {
    id: "newsletter",
    productType: "paid newsletter",
    page: {
      url: "https://themargin.email",
      title: "The Margin — indie finance for people who ship",
      description:
        "A weekly newsletter on bootstrapper finance: pricing, taxes, and runway, in plain English.",
      headings: [
        "Money advice for people who'd rather be building",
        "Every Tuesday",
        "Read by 9,200 founders",
      ],
      text: "Money advice for people who'd rather be building. Every Tuesday, The Margin breaks down one bootstrapper finance topic — pricing changes, estimated taxes, when to take a salary — in under five minutes, with real numbers from real indie companies. No jargon, no hot takes, no crypto. Read by 9,200 founders. The weekly letter is free; the $8/month tier adds the archive, spreadsheets, and a quarterly live Q&A. Subscribe free and see this week's issue in your inbox Tuesday.",
    },
    truth: {
      name: "The Margin",
      onPage: [
        "one bootstrapper finance topic",
        "Read by 9,200 founders",
        "$8/month tier adds the archive",
        "Subscribe free",
      ],
      states: { stage: false, conversionGoal: true, assets: true },
    },
  },
  {
    id: "oss-library",
    productType: "open-source library",
    page: {
      url: "https://quickcache.rs",
      title: "quickcache — a lock-free in-process cache for Rust",
      description:
        "MIT-licensed Rust crate: bounded, lock-free, TTL-aware caching with zero unsafe in the public API.",
      headings: [
        "Fast by measurement, not adjectives",
        "Benchmarks",
        "cargo add quickcache",
      ],
      text: "quickcache is a bounded in-process cache for Rust with lock-free reads, per-entry TTLs, and weighted eviction. In the included benchmarks it sustains 34 million reads per second on an M2 Pro across 8 threads — the harness is in the repo, run it yourself. Zero unsafe in the public API; the internals are fuzzed in CI. MIT licensed. Add it with cargo add quickcache. The README covers eviction tuning, and the changelog is honest about the two breaking releases so far.",
    },
    truth: {
      name: "quickcache",
      onPage: [
        "lock-free reads, per-entry TTLs, and weighted eviction",
        "34 million reads per second on an M2 Pro",
        "Zero unsafe in the public API",
        "MIT licensed",
      ],
      states: { stage: false, conversionGoal: false, assets: false },
    },
  },
  {
    id: "fintech",
    productType: "fintech app",
    page: {
      url: "https://centavo.app",
      title: "Centavo — budgeting for irregular income",
      description:
        "A budgeting app built for freelancers whose income changes every month.",
      headings: [
        "Budgets that flex with your invoices",
        "Smooth the feast and famine",
        "Bank-level security",
      ],
      text: "Budgets that flex with your invoices. Centavo is budgeting for freelancers and contractors whose income is different every month. Instead of fixed category limits, it smooths your last six months of income into a safe-to-spend number that updates as invoices land. Tax set-aside is automatic — it moves your estimated percentage into a virtual envelope every time you're paid. Read-only bank connections via Plaid, encrypted at rest, and we never sell data. iOS and web. $7/month, first month free.",
    },
    truth: {
      name: "Centavo",
      onPage: [
        "smooths your last six months of income into a safe-to-spend number",
        "Tax set-aside is automatic",
        "Read-only bank connections via Plaid",
        "$7/month, first month free",
      ],
      states: { stage: false, conversionGoal: false, assets: false },
    },
  },
  {
    id: "health-fitness",
    productType: "health & fitness app",
    page: {
      url: "https://repcount.fit",
      title: "Repcount — the gym log you can use mid-set",
      description: "A no-frills workout logger designed for one-thumb use between sets.",
      headings: ["Log a set in two taps", "Your program, not ours", "Works offline"],
      text: "Log a set in two taps, even with a plate in your other hand. Repcount is a workout logger with zero social feed, zero coaching upsell, and a rest timer that starts itself. Bring your own program — it learns your exercises and suggests last session's weight so you just confirm or bump it. Full history and PR tracking, CSV export, and it works offline in a basement gym. Android and iOS. Free for three months of history; $20/year for unlimited.",
    },
    truth: {
      name: "Repcount",
      onPage: [
        "zero social feed, zero coaching upsell",
        "suggests last session's weight",
        "works offline in a basement gym",
        "$20/year for unlimited",
      ],
      states: { stage: false, conversionGoal: false, assets: false },
    },
  },
  {
    id: "indie-game",
    productType: "indie game",
    page: {
      url: "https://gridlore.game",
      title: "Gridlore — a roguelike where the map is the puzzle",
      description:
        "A turn-based roguelike about rewiring the dungeon itself. Wishlist on Steam.",
      headings: ["Rewire the dungeon", "Every floor is a circuit", "Wishlist on Steam"],
      text: "Rewire the dungeon. In Gridlore, every floor is a living circuit: doors, traps, and enemies all draw power from the same grid, and your real weapon is the wiring. Cut power to a boss room, overload a corridor, or route everything into the exit elevator and run. Runs are 20 to 40 minutes. 140 hand-designed components combine into builds we genuinely didn't predict during four years of development. Coming to Steam in Early Access this fall — wishlist now, and the demo is playable in the current Steam Next Fest.",
    },
    truth: {
      name: "Gridlore",
      onPage: [
        "every floor is a living circuit",
        "Runs are 20 to 40 minutes",
        "Coming to Steam in Early Access this fall",
        "the demo is playable in the current Steam Next Fest",
      ],
      states: { stage: true, conversionGoal: true, assets: false },
    },
  },
  {
    id: "edtech-course",
    productType: "online course / edtech",
    page: {
      url: "https://sqlcamp.dev",
      title: "SQLCamp — learn SQL by fixing a broken company database",
      description:
        "An interactive course where every lesson is a ticket against a realistic messy database.",
      headings: [
        "Learn SQL like it's your job",
        "80 tickets, one messy database",
        "Lifetime access",
      ],
      text: "Learn SQL like it's your job — because the course IS a job. SQLCamp drops you into a fictional company's genuinely messy database with 80 tickets to close: broken reports, slow queries, suspicious numbers the CFO wants explained. Everything runs in the browser against real Postgres; no setup. Hints escalate from nudge to full walkthrough, so you're never stuck or spoon-fed. Written by a data engineer who's interviewed 200+ analysts. $89 one-time, lifetime access, free updates. The first 10 tickets are free — no signup.",
    },
    truth: {
      name: "SQLCamp",
      onPage: [
        "80 tickets to close",
        "runs in the browser against real Postgres",
        "$89 one-time, lifetime access",
        "The first 10 tickets are free",
      ],
      states: { stage: false, conversionGoal: true, assets: false },
    },
  },
  {
    id: "design-tool",
    productType: "design tool",
    page: {
      url: "https://kernwork.app",
      title: "Kernwork — find the font pairing in your actual design",
      description:
        "A Figma plugin that tests font pairings inside your real frames, not in a specimen page.",
      headings: ["Pairings in context", "Test in your real frames", "Free during beta"],
      text: "Font specimens lie. A pairing that sings on a specimen page can fall apart in your actual layout. Kernwork is a Figma plugin that swaps candidate pairings directly into your real frames — headlines, body, captions — and shows them side by side so you judge the pairing where it will live. Filters for licensing (Google Fonts, Adobe Fonts, or files you own) and x-height compatibility. One click writes the winning pair into your text styles. Free while in beta; pricing later, beta users keep a discount.",
    },
    truth: {
      name: "Kernwork",
      onPage: [
        "swaps candidate pairings directly into your real frames",
        "Filters for licensing",
        "Free while in beta",
        "beta users keep a discount",
      ],
      states: { stage: true, conversionGoal: false, assets: false },
    },
  },
];
