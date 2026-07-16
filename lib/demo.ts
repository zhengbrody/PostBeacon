import type { Fact, GenerateResult, MarketingStrategy, ProductProfile } from "./types";
import { PLATFORMS } from "./platforms";
import { groundRecommendations, toRecommendation } from "./scoring";

/**
 * A hand-authored, end-to-end example plan. It powers the in-app "See an example
 * plan" path so anyone — including GitHub visitors with no API key — can explore
 * the full dashboard instantly, for free. It's also the product's quality bar:
 * the content here is written to the same anti-AI standard the generator targets,
 * so keep it honest, specific, and free of marketing voice.
 *
 * The product is fictional (Cronwise) on purpose — believable, not a real company.
 */

const profile: ProductProfile = {
  name: "Cronwise",
  tagline: "Know the second a background job silently dies.",
  valueProp:
    "Cronwise watches your cron jobs and workers and pings you the moment one stops checking in — before anything downstream breaks.",
  audience:
    "Solo developers and small teams running scheduled jobs (backups, billing, exports) with no dedicated ops person.",
  differentiators: [
    "Setup is one curl line at the end of a job — no agent, no library",
    "Tells 'late' apart from 'dead', so it warns you before a job fully fails",
    "Flat $9/mo, not per-check pricing",
    "Self-host option for people who don't want to depend on someone else's server",
  ],
  features: [
    "Heartbeat URLs for any cron or worker",
    "Late / missed / recovered alerts to Slack, email, or SMS",
    "Per-job grace windows and schedules",
    "A status timeline you can share with your team",
    "Import straight from an existing crontab",
  ],
  tone: "plain, technical, slightly dry",
  category: "developer tool",
  stage: "Just launched — first users trickling in",
  conversionGoal: "Free signups that connect a first job",
  assets: "≈1.2k X followers from building in public; no ad budget; ~10 hrs/week",
  whatItIs:
    "A dead-simple monitor for the scheduled jobs your app depends on. Each job pings a URL when it finishes; Cronwise yells if a ping doesn't arrive on time.",
  whyCare:
    "Cron jobs fail silently. The backup that quietly stopped three weeks ago is only a problem the day you need a restore. Most people find out from an angry customer, not a dashboard.",
  useCase:
    "Your nightly Stripe reconciliation throws on a weekend. Cronwise texts you at 2am instead of you finding mismatched invoices on Monday.",
  confidence: "high",
  confidenceNote: "",
  publisherVoice: "founder",
};

// The demo ledger shows every provenance state the real pipeline produces:
// observed (machine-checked page quotes), inferred (the model's read), and
// user-confirmed (the founder answered the clarifying questions).
const VERIFIED_AT = "2026-07-08T09:00:00.000Z";
const facts: Fact[] = [
  {
    id: "tagline",
    field: "tagline",
    claim: "Know the second a background job silently dies.",
    evidence: "Know the second a background job silently dies.",
    sourceUrl: "https://cronwise.dev",
    sourceType: "page",
    status: "observed",
    confidence: 0.95,
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "valueProp",
    field: "valueProp",
    claim: "Watches cron jobs and workers and alerts the moment one stops checking in.",
    evidence: "pings you the moment one stops checking in",
    sourceUrl: "https://cronwise.dev",
    sourceType: "page",
    status: "observed",
    confidence: 0.9,
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "audience",
    field: "audience",
    claim:
      "Solo developers and small teams running scheduled jobs with no dedicated ops person.",
    sourceType: "model",
    status: "inferred",
    confidence: 0.6,
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "category",
    field: "category",
    claim: "Developer tool — job/heartbeat monitoring.",
    evidence: "watches your cron jobs and workers",
    sourceUrl: "https://cronwise.dev",
    sourceType: "page",
    status: "observed",
    confidence: 0.9,
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "pricing",
    field: "pricing",
    claim: "Flat $9/mo past the free tier, with a self-host option.",
    evidence: "Flat $9/mo, not per-check pricing",
    sourceUrl: "https://cronwise.dev",
    sourceType: "page",
    status: "observed",
    confidence: 0.9,
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "stage",
    field: "stage",
    claim: "Just launched — first users trickling in",
    sourceType: "user",
    status: "user-confirmed",
    confidence: 1,
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "conversionGoal",
    field: "conversionGoal",
    claim: "Free signups that connect a first job",
    sourceType: "user",
    status: "user-confirmed",
    confidence: 1,
    lastVerifiedAt: VERIFIED_AT,
  },
  {
    id: "assets",
    field: "assets",
    claim: "≈1.2k X followers from building in public; no ad budget; ~10 hrs/week",
    sourceType: "user",
    status: "user-confirmed",
    confidence: 1,
    lastVerifiedAt: VERIFIED_AT,
  },
];

// Validated niche channels (what the live discovery pass would find). These
// are what GROUND the "✓ sourced" chips — venue text matching one of these
// names earns provenance "grounded"; everything else stays "inferred".
const discoveries = [
  {
    name: "r/selfhosted",
    url: "https://www.reddit.com/r/selfhosted/",
    why: "Self-hosters run fleets of unattended jobs and adopt tools with a self-host story fast.",
    source: "subreddit",
    validated: true,
  },
  {
    name: "r/devops",
    url: "https://www.reddit.com/r/devops/",
    why: "Where the 'how do you monitor cron' complaint thread already exists.",
    source: "subreddit",
    validated: true,
  },
  {
    name: "awesome-selfhosted",
    url: "https://github.com/awesome-selfhosted/awesome-selfhosted",
    why: "A PR into the monitoring section reaches self-hosters searching for exactly this.",
    source: "GitHub list",
    validated: true,
  },
];

// Demo recommendations are assembled with the REAL production functions:
// the model-shaped raw entries below carry only dimensions + reasons, and
// toRecommendation() computes the 0-100 total, priority, effort (catalog)
// and evidence quality exactly as the live pipeline does.
const rawRecs = [
  {
    platformId: "hackernews",
    dimensions: {
      audienceFit: {
        score: 10,
        reason:
          "Senior devs who've been bitten by silent job failures are the core HN crowd.",
        factIds: ["audience", "valueProp"],
      },
      intentFit: {
        score: 9,
        reason: "Show HN readers are actively hunting new tools to try that morning.",
        factIds: ["stage"],
      },
      nativeContentFit: {
        score: 9,
        reason: "A failure story plus a curl one-liner is textbook Show HN material.",
        factIds: ["valueProp"],
      },
      founderAccess: {
        score: 8,
        reason: "No karma needed to post a Show HN; comments decide everything.",
        factIds: [],
      },
      risk: {
        score: 7,
        reason: "One marketing-scented sentence gets it flagged; the crowd is merciless.",
        factIds: [],
      },
    },
    confidence: "high",
    rationale:
      "Your exact buyer — senior devs who've been bitten by a silent failure — and one front-page Show HN beats months of any other channel.",
    angle: "The honest failure story plus the one-line setup. No adjectives.",
    bestMove: "Post Show HN Tue–Thu morning and live in the comments for six hours.",
    venue: "Show HN",
  },
  {
    platformId: "reddit",
    dimensions: {
      audienceFit: {
        score: 9,
        reason: "r/selfhosted and r/devops members run unattended jobs daily.",
        factIds: ["audience"],
      },
      intentFit: {
        score: 8,
        reason:
          "Monitoring complaints already recur in both subs — the pain is pre-stated.",
        factIds: [],
      },
      nativeContentFit: {
        score: 9,
        reason: "Self-host option makes it shareable in r/selfhosted, not just tolerated.",
        factIds: ["pricing"],
      },
      founderAccess: {
        score: 7,
        reason: "Fresh accounts get filtered; needs genuine member behavior first.",
        factIds: [],
      },
      risk: {
        score: 8,
        reason: "Cross-posted promo is a ban; each sub needs its own honest post.",
        factIds: [],
      },
    },
    confidence: "high",
    rationale:
      "r/selfhosted and r/devops run unattended jobs constantly and reward a self-hostable tool — if you post as a member, not a vendor.",
    angle: "Open with the failure story and a real question about how they monitor today.",
    bestMove:
      "One subreddit at a time, starting with r/selfhosted, flaired correctly, link last.",
    venue: "r/selfhosted",
  },
  {
    platformId: "twitter",
    dimensions: {
      audienceFit: {
        score: 8,
        reason: "The build-in-public crowd overlaps heavily with solo devs running crons.",
        factIds: ["audience", "assets"],
      },
      intentFit: {
        score: 6,
        reason: "Feed browsing, not tool hunting — the story has to stop the scroll.",
        factIds: [],
      },
      nativeContentFit: {
        score: 8,
        reason: "A 6-second setup GIF plus a real failure story is native here.",
        factIds: ["valueProp"],
      },
      founderAccess: {
        score: 8,
        reason:
          "An existing 1.2k-follower build-in-public account seeds real distribution.",
        factIds: ["assets"],
      },
      risk: {
        score: 3,
        reason: "Low ban risk; the cost is just being ignored.",
        factIds: [],
      },
    },
    confidence: "high",
    rationale:
      "The build-in-public crowd is your buyer and shares tools that solve a pain they recognize on sight — and you already have 1.2k followers here.",
    angle: "One relatable story plus the 1-line setup recording.",
    bestMove: "Post the silent-failure story with a 6-second setup GIF.",
    venue: "build-in-public X",
  },
  {
    platformId: "github",
    dimensions: {
      audienceFit: {
        score: 8,
        reason: "Every serious evaluator of a self-hostable monitor lands on the repo.",
        factIds: ["pricing"],
      },
      intentFit: {
        score: 7,
        reason: "Repo visitors are already evaluating — the README just has to close.",
        factIds: [],
      },
      nativeContentFit: {
        score: 7,
        reason: "A curl one-liner above the fold is exactly what this audience wants.",
        factIds: ["valueProp"],
      },
      founderAccess: {
        score: 9,
        reason: "It's your own repo; no gatekeeper.",
        factIds: [],
      },
      risk: {
        score: 1,
        reason: "No community to offend — worst case is an unstarred repo.",
        factIds: [],
      },
    },
    confidence: "high",
    rationale:
      "Devs will check the repo before trusting a monitor with their jobs; a clean README and a self-host path build the credibility that closes them.",
    angle: "Show the curl one-liner above the fold; make self-host first-class.",
    bestMove:
      "Pin a 20-second demo GIF at the top of the README and PR the monitoring section of awesome-selfhosted.",
    venue: "awesome-selfhosted",
  },
  {
    platformId: "lobsters",
    dimensions: {
      audienceFit: {
        score: 7,
        reason: "Small but exactly the sysadmin/dev crowd that runs cron everywhere.",
        factIds: ["audience"],
      },
      intentFit: {
        score: 7,
        reason: "Readers came for technical depth; a timing write-up fits that intent.",
        factIds: [],
      },
      nativeContentFit: {
        score: 8,
        reason: "The per-job state machine is a genuinely Lobsters-worthy detail.",
        factIds: [],
      },
      founderAccess: {
        score: 4,
        reason: "Invite-only; without an existing invite this channel is gated.",
        factIds: [],
      },
      risk: {
        score: 8,
        reason: "Self-promotion rules are stricter than HN; must read as a write-up.",
        factIds: [],
      },
    },
    confidence: "medium",
    rationale:
      "Small but extremely high-signal audience that rewards technical depth over polish.",
    angle: "Lead with the per-job timing state machine, not the product.",
    bestMove: "Only post with an invite; frame it as a technical write-up.",
    venue: "Lobsters",
  },
  {
    platformId: "devto",
    dimensions: {
      audienceFit: {
        score: 7,
        reason: "Working devs searching 'monitor cron jobs' land here for years.",
        factIds: ["audience"],
      },
      intentFit: {
        score: 5,
        reason: "Readers want to learn, not buy — conversion is slow-burn search traffic.",
        factIds: [],
      },
      nativeContentFit: {
        score: 8,
        reason: "'How I built the timing logic' teaches first; the product is the example.",
        factIds: [],
      },
      founderAccess: {
        score: 9,
        reason: "Open platform, no reputation needed to publish.",
        factIds: [],
      },
      risk: {
        score: 2,
        reason: "Tolerant of maker posts as long as they teach something.",
        factIds: [],
      },
    },
    confidence: "medium",
    rationale:
      "A 'how I built the timing logic' post earns trust and keeps pulling search traffic long after launch day.",
    angle: "Teach the hard part; the product is just the example.",
    bestMove: "Write the state-machine post with a real code snippet.",
    venue: "Dev.to",
  },
  {
    platformId: "indiehackers",
    dimensions: {
      audienceFit: {
        score: 6,
        reason: "Founders run crons too, but ops pain is secondary to growth topics here.",
        factIds: ["audience"],
      },
      intentFit: {
        score: 5,
        reason: "People browse for stories and numbers, not infrastructure tools.",
        factIds: [],
      },
      nativeContentFit: {
        score: 7,
        reason: "A transparent $9-flat pricing story fits the milestone-post format.",
        factIds: ["pricing"],
      },
      founderAccess: {
        score: 8,
        reason: "Open community that welcomes first-time posters with real numbers.",
        factIds: [],
      },
      risk: {
        score: 3,
        reason: "Soft-sell tolerated; hard-sell just gets ignored.",
        factIds: [],
      },
    },
    confidence: "medium",
    rationale:
      "Founders here appreciate a transparent build story and the simple $9 model, though they're a softer fit than the dev communities.",
    angle: "Share real launch numbers and what actually converted.",
    bestMove: "Post a milestone with signup numbers a week after the HN launch.",
    venue: "Indie Hackers milestones",
  },
  {
    platformId: "producthunt",
    dimensions: {
      audienceFit: {
        score: 6,
        reason: "Makers browse PH, but infra tools convert worse than consumer apps.",
        factIds: [],
      },
      intentFit: {
        score: 6,
        reason: "Hunters are actively trying new tools on launch day.",
        factIds: [],
      },
      nativeContentFit: {
        score: 5,
        reason: "A monitoring tool demos less visually than PH favorites.",
        factIds: [],
      },
      founderAccess: {
        score: 7,
        reason: "Anyone can launch; ranking without a follower base is the hard part.",
        factIds: ["assets"],
      },
      risk: {
        score: 4,
        reason: "Low ban risk; real risk is a quiet launch that wastes the one shot.",
        factIds: [],
      },
    },
    confidence: "low",
    rationale:
      "Reaches makers, but this audience trusts dev communities more than PH for infra tools — worth a listing, not a campaign.",
    angle: "A maker's note about the silent-failure itch.",
    bestMove: "List it, but don't spend your one big launch day here.",
    venue: "Product Hunt",
  },
];

const platformById = new Map(PLATFORMS.map((p) => [p.id, p]));
const recommendations = groundRecommendations(
  rawRecs.map((r) => toRecommendation(r, platformById.get(r.platformId)!, facts)!),
  discoveries
).sort((a, b) => b.score - a.score);

const strategy: MarketingStrategy = {
  executiveSummary:
    "Cronwise sells one feeling: never getting blindsided by a job that quietly died. The buyer is a developer who's already been burned, so the whole plan is credibility-first — show up in the technical communities where that person is, lead with the failure story, and let the one-line setup close. Paid ads and anything that smells like marketing actively hurt here. The bet: one strong Show HN plus a few honest Reddit threads beat any amount of polish.",
  positioning:
    "Uptime monitoring for the jobs nobody watches — your crons and workers, not your website.",
  antiPositioning:
    "Don't frame it as observability, APM, or 'Datadog for cron'. The moment a solo dev hears those words they assume heavy, enterprise, and expensive — the opposite of the truth. And don't bolt 'AI-powered' onto it; there's no AI here, and claiming it would cost you trust with exactly this crowd.",
  overallStrategy:
    "Go narrow and deep before going wide. Win the developers who already know this pain on HN, Reddit, and Lobsters with a no-marketing story and a setup small enough to sell itself. Use the launch spike to seed a Dev.to post and a build-in-public presence on X that keeps a slow trickle going after the front-page traffic fades. Skip anything that needs an audience you don't have yet.",
  coldStart:
    "Your first 50 users come from one good Show HN and two honest Reddit threads, not from a funnel. Pre-write the failure story, get the curl-to-text demo recording ready, and post where senior devs already complain about this. Reply to every comment on day one.",
  phases: [
    {
      window: "Days 1–14",
      focus: "Earn credibility in technical communities",
      actions: [
        "Post the Show HN with the silent-failure story and stay in the thread all day",
        "Share in r/selfhosted and r/devops as a member asking how others monitor this — one sub at a time",
        "If you have an invite, post to Lobsters and lead with the timing-logic detail",
        "Publish a 'how I built the per-job timing state machine' post on Dev.to",
      ],
    },
    {
      window: "Days 15–30",
      focus: "Turn the spike into a steady trickle",
      actions: [
        "Start a build-in-public cadence on X: one real number or lesson a week",
        "Turn the best launch questions into an FAQ and a comparison-to-Healthchecks page for search",
        "Pitch 2–3 dev newsletters now that you have a front-page result to point to",
        "Ship the integrations people actually asked for during launch",
      ],
    },
  ],
  audienceSegments: [
    {
      tier: "primary",
      label: "Solo devs running unattended jobs",
      description:
        "One person responsible for backups, billing crons, and workers, with no ops team and no monitoring on any of it. Has been burned by a silent failure at least once.",
      whereTheyHang: "Hacker News, r/selfhosted, r/devops, indie-dev X",
    },
    {
      tier: "secondary",
      label: "Small SaaS teams without an ops hire",
      description:
        "2–10 person teams whose scheduled jobs touch revenue (billing, reports) but who can't justify Datadog. Want something they set up once and forget.",
      whereTheyHang: "Indie Hackers, r/SaaS, founder Slack/Discord groups",
    },
    {
      tier: "early-adopter",
      label: "Homelab / self-hosters",
      description:
        "People who run their own infra for fun, will try a self-hostable monitor immediately, give sharp feedback, and tell their communities if it's any good.",
      whereTheyHang: "r/selfhosted, r/homelab, Lobsters",
    },
  ],
  recommendations,
  discoveries,
  founderChecklist: [
    {
      when: "Day 0",
      task: "Record the 6-second curl-to-text demo and write the silent-failure story once — you'll reuse it everywhere.",
    },
    {
      when: "Day 1",
      task: "Post the Show HN in the morning and block the rest of the day to answer every comment.",
    },
    {
      when: "Day 1",
      task: "Make sure free signup works with zero friction — no credit card, no sales call.",
    },
    {
      when: "Daily",
      task: "Reply to every comment, DM, and email personally for the first two weeks.",
    },
    {
      when: "Week 1",
      task: "Post to r/selfhosted and r/devops on separate days, each as a genuine question.",
    },
    {
      when: "Week 1",
      task: "Publish the Dev.to build post while launch attention is still high.",
    },
    {
      when: "Week 2",
      task: "Turn the most common launch questions into an FAQ and a Healthchecks comparison page.",
    },
  ],
  risks: [
    {
      area: "Hacker News & Reddit",
      risk: "Anything that reads like marketing gets flagged, downvoted, or buried — and these are your top two channels.",
      mitigation:
        "Strip every adjective, lead with the story and the limitations, and engage as a person. Concede fair criticism instead of defending.",
    },
    {
      area: "Sounding like an ad",
      risk: "Copy-pasting the same promo post across subreddits trips spam filters and gets you banned.",
      mitigation:
        "Write each post fresh for its community, post one at a time, and put the link last.",
    },
    {
      area: "Trusting a hosted monitor",
      risk: "People are wary of handing job monitoring to an unknown service that might itself go down.",
      mitigation:
        "Offer self-host, publish a status page, and be explicit about what happens if Cronwise is unreachable.",
    },
    {
      area: "Overclaiming scope",
      risk: "If people expect logs and tracing and get only check-in alerts, you get 'is that all?' reactions.",
      mitigation:
        "Say plainly what it does and doesn't do up front, and position the simplicity as the point.",
    },
  ],
  iterationLoop: [
    {
      signal: "Show HN front-page time and comment sentiment",
      read: "Hours on the front page with real technical questions means the story landed; a quick fade means the hook was too soft.",
      ifWeak:
        "Reframe the title around the concrete failure, not the product, and try again in a few weeks.",
    },
    {
      signal: "Signup → first job connected",
      read: "If people sign up but never wire up a job, the one-line setup isn't landing or isn't trusted yet.",
      ifWeak:
        "Put the exact curl line in onboarding with a 10-second video; cut steps to the first ping.",
    },
    {
      signal: "Free → paid past 5 jobs",
      read: "Upgrades mean the free tier proved its worth; flat conversion means $9 isn't tied to a felt limit.",
      ifWeak:
        "Revisit where the free cap sits and make the 'you have unmonitored jobs' nudge concrete.",
    },
  ],
};

const result: GenerateResult = {
  content: [
    {
      platformId: "hackernews",
      platformName: "Hacker News",
      posts: [
        {
          hook: "Show HN: Cronwise – know when a cron job silently stops running",
          hookVariants: [
            "Show HN: Cronwise – heartbeat monitoring for cron jobs and workers",
            "Show HN: I built a cron monitor after a backup died for 3 months unnoticed",
          ],
          body: "I kept getting bitten by the same thing: a scheduled job — a backup, a nightly export, a billing reconcile — would quietly stop running, and I'd find out days later when something downstream was already broken.\n\nCronwise is the smallest fix I could make for that. Each job pings a URL when it finishes. If a ping doesn't arrive inside the window you set, you get told (Slack, email, or SMS). That's the whole product.\n\nThere's no agent and no library. You add one line to the end of the job:\n\n  curl -fsS https://cronwise.dev/p/<id>\n\nCronwise knows each job's expected schedule and grace period, so it can tell 'late' apart from 'dead' and won't page you for a job that's two minutes slow. The part that took the most work was that timing logic — irregular schedules, timezones, and overlapping runs without false alarms. It's a small state machine per job rather than a flat timeout.\n\nLimitations, since this is HN: it only tells you a job didn't check in, not why. No log ingestion, no tracing. If you already run Datadog or have real on-call, this isn't for you. It's for the solo dev or small team with 20 cron jobs and no monitoring on any of them.\n\nFree for 5 jobs, $9/mo past that, and there's a self-host option. Happy to answer anything.",
          imageSuggestion: "none — HN is text-first; let the curl line carry it",
          bestTime: "Weekday 8–10am ET, Tue–Thu",
          caveats:
            "No adjectives, no vision pitch. Don't argue with skeptics — concede the fair points.",
        },
      ],
      playbook: {
        whyThisPlatform:
          "HN is full of the exact people who've been burned by a silent cron failure and will respect a small, honest tool. One front-page Show HN can outproduce a month of everything else.",
        howToPost:
          "Submit as 'Show HN: ...' with the plain URL, then immediately add a maker comment with the backstory and the limitations. Stay in the thread for the next 4–6 hours answering everything.",
        whatToAvoid:
          "Any adjective. Don't call it powerful or seamless, don't pitch a vision, and never get defensive — marketing tone gets flagged and buried here faster than anywhere.",
        firstReplies: [
          "Happy to go into the timing logic — the tricky part was telling 'late' apart from 'failed' for jobs that don't run on a clean fixed interval.",
          "Fair to compare it to Healthchecks.io — that's the closest thing. Main differences are the grace-window handling and that I wanted a hosted option I didn't have to run myself.",
          "It's open to self-host if you'd rather not depend on me — repo's in my profile.",
        ],
        postingWindow: "Tue–Thu, 8–10am ET",
      },
    },
    {
      platformId: "twitter",
      platformName: "X / Twitter",
      posts: [
        {
          hook: "A backup job on one of my projects stopped running in March. I found out in June.",
          hookVariants: [
            "Your cron jobs fail silently. Here's the one-line fix I built.",
            "The backup had been failing for three months. Nothing told me.",
          ],
          body: "Nothing told me — the job just stopped. So I built the fix: every cron pings a URL when it finishes, and a missed ping becomes a text to my phone.\n\nOne line: curl -fsS cronwise.dev/p/your-id",
          imageSuggestion:
            "A 6-second screen recording: paste the curl line at the end of a crontab, then a phone buzzing with a 'job is late' text.",
          bestTime: "Tue–Thu 9–11am ET",
          caveats:
            "Don't turn it into a thread of growth tips. One story, one line of code, one link.",
        },
      ],
      playbook: {
        whyThisPlatform:
          "The build-in-public crowd on X is your exact buyer, and they share tools that solve a pain they recognize. The silent-failure story is instantly relatable.",
        howToPost:
          "Lead with the story, not the product. Put the link on its own line at the end. Attach the screen recording — the one-line setup is the strongest selling point, so show it.",
        whatToAvoid:
          "No 'I'm excited to announce', no hashtag pile, no thread-bro formatting. Post it as a thing that happened to you, not as a launch.",
        firstReplies: [
          "The setup really is one line — just a curl at the end of the job. No agent, no library.",
          "There's a self-host option if you don't want to depend on my server.",
          "Free for 5 jobs, so you can wire up the important ones without paying.",
        ],
        postingWindow: "Tue–Thu, 9–11am ET",
      },
    },
    {
      platformId: "reddit",
      platformName: "Reddit",
      posts: [
        {
          hook: "After a backup silently failed for 3 months, I built a dead-simple cron monitor",
          hookVariants: [
            "How do you all catch cron jobs that fail silently?",
            "Built a tiny, self-hostable cron monitor after getting burned by a dead backup",
          ],
          body: "Posting here because this crowd runs more unattended jobs than anyone.\n\nContext: I had a nightly backup that stopped running back in spring. No email, no exit-code alert, nothing. I only caught it when I actually needed a restore. Classic.\n\nI wanted something simpler than wiring up Prometheus for this, so I made Cronwise. Each job hits a URL when it's done (a curl at the end of the script). You tell it the schedule and a grace period; if the check-in doesn't land in time, it alerts you. It can tell 'a few minutes late' apart from 'didn't run', which was the main thing I wanted.\n\nIt's hosted, but there's a self-host option because I know this sub. Free for 5 jobs.\n\nNot trying to pitch hard — mostly curious how you all monitor this today, because every answer I've seen is either 'I don't' or a setup much heavier than the problem deserves.",
          imageSuggestion:
            "A screenshot of the status timeline: one job flipping from 'on time' to 'late' to 'recovered'.",
          bestTime: "Weekday mornings, US",
          caveats:
            "Read the sub rules first; many require a self-promo flair and real engagement. Lead with the question, not the link.",
        },
      ],
      playbook: {
        whyThisPlatform:
          "r/selfhosted and r/devops run unattended jobs constantly and are sympathetic to a small, self-hostable tool — as long as you show up as a member, not a vendor.",
        howToPost:
          "Post to one subreddit at a time, flaired correctly. Open with the failure story and a genuine question about how they monitor today. Mention self-host early; this audience cares.",
        whatToAvoid:
          "Don't drop a link and leave. Don't cross-post identical text to five subs the same day — that's the fastest route to a ban. No marketing voice at all.",
        firstReplies: [
          "To be clear it's not trying to replace Prometheus — closest thing is Healthchecks.io, which is great. I just wanted the grace-window handling and a hosted option I didn't maintain.",
          "Self-host instructions are in the repo if you'd rather run it yourself.",
          "Genuinely curious what you're on now — if it's a bash script piping to email, I'd love to see it.",
        ],
        postingWindow: "Weekday mornings, US",
      },
    },
  ],
  schedule: [
    {
      day: 1,
      platformId: "twitter",
      platformName: "X / Twitter",
      action:
        "Post the build-in-public story with the 1-line setup recording (Tue–Thu 9–11am ET).",
    },
    {
      day: 1,
      platformId: "github",
      platformName: "GitHub",
      action:
        "Ship the README with the demo GIF and self-host instructions above the fold.",
    },
    {
      day: 3,
      platformId: "hackernews",
      platformName: "Hacker News",
      action:
        "Show HN with the silent-failure story; live in the comments all day (weekday 8–10am ET).",
    },
    {
      day: 4,
      platformId: "lobsters",
      platformName: "Lobsters / specialist forums",
      action: "With an invite, post the timing-logic write-up (weekday).",
    },
    {
      day: 5,
      platformId: "indiehackers",
      platformName: "Indie Hackers",
      action: "Share the build and the $9 model; soft product mention at the end.",
    },
    {
      day: 6,
      platformId: "reddit",
      platformName: "Reddit",
      action:
        "Post to r/selfhosted as a member asking how others monitor jobs (weekday morning).",
    },
    {
      day: 9,
      platformId: "devto",
      platformName: "Dev.to",
      action: "Publish 'how I built the per-job timing state machine'.",
    },
  ],
};

/** The example "project" the app loads when a visitor explores the demo. */
export const DEMO_PROJECT = {
  id: "demo",
  url: "cronwise.dev",
  profile,
  facts,
  strategy,
  result,
  posted: {} as Record<string, boolean>,
  launchDate: "",
};
