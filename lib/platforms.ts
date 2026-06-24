export type PlatformCategory =
  | "launch"
  | "dev-community"
  | "social"
  | "content"
  | "video"
  | "forum-niche"
  | "newsletter"
  | "aggregator";

export interface PlatformDef {
  id: string;
  name: string;
  category: PlatformCategory;
  blurb: string; // short tag shown in UI
  reaches: string; // who you reach here — used by the strategist
  effort: "low" | "medium" | "high"; // effort to do it well
  postCount: number; // distinct posts to generate
  defaultDay: number; // day offset in the launch sequence (1 = launch day)
  bestTime: string;
  guidance: string; // voice/format rules for content generation
}

// English-first platform universe. The strategist scores ALL of these for a
// given product; content is only generated for the ones the user keeps.
export const PLATFORMS: PlatformDef[] = [
  // ---- Launch ----
  {
    id: "producthunt",
    name: "Product Hunt",
    category: "launch",
    blurb: "Tagline + maker 首条评论",
    reaches: "early adopters, makers, tech press scouting new tools",
    effort: "high",
    postCount: 2,
    defaultDay: 7,
    bestTime: "12:01am PT launch day",
    guidance:
      "Produce (1) a tagline (<60 chars) and (2) the maker's first comment: who you are, why you built it, what's different, a question to spark discussion. Humble, specific, no hype words.",
  },
  {
    id: "hackernews",
    name: "Hacker News",
    category: "launch",
    blurb: "Show HN 技术诚实贴",
    reaches: "senior engineers, founders, deeply technical skeptics",
    effort: "high",
    postCount: 1,
    defaultDay: 3,
    bestTime: "Weekday 8–10am ET",
    guidance:
      "'Show HN: <name> – <what it does>' title + plain body. Radically de-marketed, technically honest: what it does, how built, the hard part, limitations. No adjectives. Comments are where it's won.",
  },
  {
    id: "betalist",
    name: "BetaList / launch dirs",
    category: "launch",
    blurb: "Beta 目录冷启动",
    reaches: "early-adopter newsletter audiences hunting new startups",
    effort: "low",
    postCount: 1,
    defaultDay: 2,
    bestTime: "Any weekday",
    guidance:
      "Short, punchy startup description (50-80 words) + one-liner. Optimized for directory skimming. Clear who-it's-for and the single biggest benefit.",
  },

  // ---- Dev community ----
  {
    id: "devto",
    name: "Dev.to",
    category: "dev-community",
    blurb: "技术教程式软文",
    reaches: "web/app developers who learn by reading tutorials",
    effort: "medium",
    postCount: 1,
    defaultDay: 9,
    bestTime: "Weekday mornings",
    guidance:
      "'How I built X' tutorial-style outline + intro. Teach something genuinely useful; product is the natural example. Suggest tags + a code-snippet idea. Value-first.",
  },
  {
    id: "indiehackers",
    name: "Indie Hackers",
    category: "dev-community",
    blurb: "Milestone / 经验贴",
    reaches: "bootstrapped founders & solo builders",
    effort: "medium",
    postCount: 1,
    defaultDay: 5,
    bestTime: "Weekday mornings",
    guidance:
      "Milestone or lessons-learned post. Lead with a number or hard-won lesson. Transparent about revenue/users/process. Soft product mention at the end.",
  },
  {
    id: "github",
    name: "GitHub",
    category: "dev-community",
    blurb: "README + Releases",
    reaches: "developers evaluating whether to adopt/trust the tool",
    effort: "medium",
    postCount: 1,
    defaultDay: 1,
    bestTime: "Anytime",
    guidance:
      "A crisp README hero section: one-line pitch, demo placeholder, quickstart, why-it's-different. Plus a release note style announcement. Technical, scannable.",
  },
  {
    id: "stackoverflow",
    name: "Stack Overflow / Q&A",
    category: "dev-community",
    blurb: "答疑式自然引流",
    reaches: "developers actively searching for a solution you solve",
    effort: "medium",
    postCount: 1,
    defaultDay: 12,
    bestTime: "Anytime",
    guidance:
      "Outline 1-2 genuine questions your product answers, with a high-quality answer that mentions the tool only as one option. Never spam; lead with a real, complete solution.",
  },

  // ---- Social ----
  {
    id: "twitter",
    name: "X / Twitter",
    category: "social",
    blurb: "Build-in-public + thread",
    reaches: "indie hackers, devs, the build-in-public crowd",
    effort: "medium",
    postCount: 2,
    defaultDay: 1,
    bestTime: "Tue–Thu 9–11am ET",
    guidance:
      "One punchy build-in-public post AND one thread (3-5 tweets). First line is everything — lead with a result, surprising claim, or pain. 0-1 hashtags. Soft CTA + link. Suggest a demo GIF.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    category: "social",
    blurb: "专业叙事/创始人故事",
    reaches: "professionals, B2B buyers, hiring/partnership audience",
    effort: "medium",
    postCount: 1,
    defaultDay: 4,
    bestTime: "Tue–Thu 8–10am",
    guidance:
      "A founder-voice narrative post. Hook on line 1, short paragraphs, a story or insight, then the product as the payoff. Professional but human. End with a question.",
  },
  {
    id: "reddit",
    name: "Reddit",
    category: "social",
    blurb: "分 subreddit 定制",
    reaches: "highly specific niche communities by interest",
    effort: "high",
    postCount: 2,
    defaultDay: 6,
    bestTime: "Weekday mornings (per subreddit)",
    guidance:
      "Posts for 2 relevant subreddits (pick by product, e.g. r/SideProject, r/webdev). Lead with value/story, not product. Title + body per subreddit + reminder to read the rules. Never sound like an ad.",
  },
  {
    id: "threads",
    name: "Threads / Bluesky / Mastodon",
    category: "social",
    blurb: "新社交去中心化",
    reaches: "tech-forward early movers leaving/avoiding X",
    effort: "low",
    postCount: 1,
    defaultDay: 8,
    bestTime: "Weekday late morning",
    guidance:
      "A conversational, slightly more earnest version of the X post. Less hashtag, more community-native and authentic. One clear idea + link.",
  },

  // ---- Content ----
  {
    id: "medium",
    name: "Medium / Substack",
    category: "content",
    blurb: "深度长文/Newsletter",
    reaches: "readers who follow thinking, not just tools",
    effort: "high",
    postCount: 1,
    defaultDay: 14,
    bestTime: "Tue/Wed morning",
    guidance:
      "Long-form article outline + a strong intro. Frame around a problem/insight the audience cares about; product appears as the embodied solution. Include a suggested title + subtitle.",
  },
  {
    id: "ph-blog",
    name: "Your blog / SEO",
    category: "content",
    blurb: "SEO 长尾内容",
    reaches: "people Googling the problem for months/years to come",
    effort: "high",
    postCount: 1,
    defaultDay: 10,
    bestTime: "N/A (evergreen)",
    guidance:
      "An SEO-targeted article: suggest a primary keyword, title, H2 outline, and intro. Answer the searcher's intent fully; product is one recommended path.",
  },

  // ---- Video ----
  {
    id: "youtube",
    name: "YouTube",
    category: "video",
    blurb: "Demo/教程视频",
    reaches: "people who want to see it work before trying",
    effort: "high",
    postCount: 1,
    defaultDay: 11,
    bestTime: "Weekend or Tue/Thu",
    guidance:
      "A demo/tutorial video script outline: hook (first 8s), the problem, the build/demo, the payoff, CTA. Plus a click-worthy title + description with timestamps.",
  },
  {
    id: "tiktok",
    name: "TikTok / Shorts / Reels",
    category: "video",
    blurb: "短视频钩子",
    reaches: "broad, younger, discovery-driven audience",
    effort: "high",
    postCount: 1,
    defaultDay: 13,
    bestTime: "Evenings",
    guidance:
      "A 15-30s short-form video script: a 2-second pattern-break hook, fast value, a 'wait what' moment, CTA. Plus 3 caption options and trending-format suggestions.",
  },

  // ---- Forum / niche ----
  {
    id: "discord-slack",
    name: "Discord / Slack communities",
    category: "forum-niche",
    blurb: "社区软植入",
    reaches: "tight-knit communities where your users already hang out",
    effort: "medium",
    postCount: 1,
    defaultDay: 5,
    bestTime: "When community is active",
    guidance:
      "A genuine, non-spammy intro message for relevant communities: contribute value first, share the product as 'I made this, would love feedback'. Suggest which kinds of servers to find.",
  },
  {
    id: "lobsters",
    name: "Lobsters / specialist forums",
    category: "forum-niche",
    blurb: "硬核技术论坛",
    reaches: "very technical, low-tolerance-for-marketing audiences",
    effort: "medium",
    postCount: 1,
    defaultDay: 4,
    bestTime: "Weekday",
    guidance:
      "A technically deep, no-fluff submission framing. Lead with the interesting technical substance, not the product. Honest about tradeoffs.",
  },

  // ---- Aggregator / newsletter ----
  {
    id: "newsletters",
    name: "Dev/startup newsletters",
    category: "newsletter",
    blurb: "投稿到Newsletter",
    reaches: "curated audiences via trusted curators (TLDR, etc.)",
    effort: "low",
    postCount: 1,
    defaultDay: 8,
    bestTime: "N/A (pitch)",
    guidance:
      "A short pitch email to newsletter curators: what it is, why their audience cares, one stat/hook, link. 80-120 words, scannable.",
  },
  {
    id: "communities-aggregators",
    name: "Niche aggregators",
    category: "aggregator",
    blurb: "垂直聚合站",
    reaches: "audiences on tool directories & 'awesome' lists in your niche",
    effort: "low",
    postCount: 1,
    defaultDay: 9,
    bestTime: "Anytime",
    guidance:
      "A concise listing entry + a suggestion of which directory/'awesome-X' lists fit this product. One-liner + 2-sentence description.",
  },
];

export function getPlatforms(ids: string[]): PlatformDef[] {
  // preserve the catalog order
  return PLATFORMS.filter((p) => ids.includes(p.id));
}

// Compact view for the strategist prompt (keeps tokens down).
export function platformCatalogForStrategist() {
  return PLATFORMS.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    reaches: p.reaches,
    effort: p.effort,
  }));
}
