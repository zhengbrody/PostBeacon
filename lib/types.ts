export type Provider = "claude" | "openai" | "deepseek";

/** How grounded a model's conclusion is vs. inferred from a thin page. */
export type Confidence = "high" | "medium" | "low";

export interface ProductProfile {
  name: string;
  tagline: string;
  valueProp: string;
  audience: string;
  differentiators: string[];
  features: string[];
  tone: string;
  category: string;
  // --- business diagnosis (M7) — formed by /api/analyze, not just scraped ---
  whatItIs?: string; // plain language: what it actually does for a person
  whyCare?: string; // the real pain / reason someone would care
  useCase?: string; // a concrete moment where someone reaches for it
  confidence?: Confidence; // how much of this is grounded vs. inferred
  confidenceNote?: string; // what had to be inferred (shown when not "high")
}

export interface PlatformPost {
  hook: string; // headline / first line — the thing that decides life or death
  hookVariants?: string[]; // alternative hooks to A/B test (same body works for each)
  body: string;
  imageSuggestion: string;
  bestTime: string;
  caveats: string; // platform-specific do-nots
}

/** Operational guidance for ONE platform — how a founder actually runs it. */
export interface PlatformPlaybook {
  whyThisPlatform: string; // why it fits THIS product (1-2 sentences)
  howToPost: string; // mechanics: where exactly, format, what to lead with
  whatToAvoid: string; // the move that gets you flagged / ignored here
  firstReplies: string[]; // 2-3 replies the founder can drop to seed discussion
  postingWindow: string; // the specific best window to post
}

export interface PlatformContent {
  platformId: string;
  platformName: string;
  posts: PlatformPost[];
  playbook?: PlatformPlaybook; // M7 — per-platform operating guidance
}

export interface ScheduleItem {
  day: number; // day offset from launch (day 1 = launch day)
  date?: string;
  platformId: string;
  platformName: string;
  action: string;
}

export interface GenerateResult {
  content: PlatformContent[];
  schedule: ScheduleItem[];
}

export type Priority = "high" | "medium" | "low";

export interface PlatformRecommendation {
  platformId: string;
  platformName: string;
  score: number; // 0-100 fit for this product
  priority: Priority;
  effort?: "low" | "medium" | "high"; // attached from the platform catalog
  confidence?: Confidence; // the model's confidence in this fit call
  rationale: string; // why this platform, for this product
  angle: string; // the specific marketing angle to use here
  bestMove?: string; // the single highest-leverage action on this channel
}

// ---- The CMO plan (M7): the strategic narrative around the channel ranking ----

export interface AudienceSegment {
  tier: "primary" | "secondary" | "early-adopter";
  label: string; // e.g. "Solo SaaS founders shipping their first paid product"
  description: string; // who they are and what they actually want
  whereTheyHang: string; // the channels / communities they already live in
}

export interface GtmPhase {
  window: string; // e.g. "Cold start", "Days 1–14", "Days 15–30"
  focus: string; // the single goal of this phase
  actions: string[]; // concrete moves, in order
}

export interface FounderTask {
  when: string; // "Daily", "Day 1", "Week 1"
  task: string; // the concrete action
}

export interface RiskItem {
  area: string; // a platform or a theme, e.g. "Reddit", "Sounding like an ad"
  risk: string; // what can go wrong
  mitigation: string; // how to avoid it
}

export interface IterationMetric {
  signal: string; // what to watch after posting
  read: string; // what a strong / weak reading means
  ifWeak: string; // the adjustment to make if it's weak
}

export interface MarketingStrategy {
  executiveSummary?: string; // M7 — the 3-4 sentence read a CMO would open with
  positioning: string; // the core narrative to lead with everywhere
  antiPositioning?: string; // M7 — how NOT to position / what to never say
  overallStrategy: string; // the CMO's plan in a few sentences
  coldStart?: string; // M7 — the very first traction path (0 → first users)
  phases?: GtmPhase[]; // M7 — the sequenced 14 / 30-day plan
  audienceSegments?: AudienceSegment[]; // M7 — primary / secondary / early adopter
  founderChecklist?: FounderTask[]; // M7 — what the founder does, by cadence
  risks?: RiskItem[]; // M7 — where launches go sideways + mitigations
  iterationLoop?: IterationMetric[]; // M7 — what to measure and how to adjust
  recommendations: PlatformRecommendation[]; // ALL platforms, scored & ranked
  // Phase-2: communities/subreddits/competitor mentions discovered live on the web
  discoveries?: DiscoveredChannel[];
}

export interface DiscoveredChannel {
  name: string;
  url: string;
  why: string;
  source: string; // how it was found (e.g. "Tavily" when grounded, "AI" otherwise)
  validated?: boolean; // true if the URL was confirmed reachable / came from live search
}

// ---- Launch Copilot (M10): a CMO assistant scoped to the CURRENT plan ----

export type CopilotAction =
  | "explain-plan" // walk me through the plan's logic
  | "next-steps" // what do I do next, concretely
  | "improve-posts" // find + rewrite the posts that smell like AI
  | "rewrite" // rewrite the posts for one platform (targetPlatformId)
  | "first-replies" // replies to seed one platform's thread (targetPlatformId)
  | "review-feedback" // read pasted comments/results against the plan
  | "ask"; // free-form question about this launch

export interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
}

/** A copy-ready replacement for a drafted post. Applies via updatePost when it
 *  resolves to an existing [platformId, postIndex]; otherwise it's copy-only. */
export interface CopilotRewrite {
  platformId?: string;
  postIndex?: number;
  label: string; // e.g. "Reddit post 2 — cut the ad voice"
  hook?: string;
  body: string;
}

export interface CopilotReply {
  reply: string; // plain text answer
  rewrites?: CopilotRewrite[];
}

export interface CopilotRequest {
  provider?: Provider;
  profile: ProductProfile;
  strategy: MarketingStrategy;
  result?: GenerateResult | null;
  launchDate?: string;
  action: CopilotAction;
  question?: string; // free question / rewrite direction / pasted feedback
  targetPlatformId?: string; // required for "rewrite" and "first-replies"
  history?: CopilotMessage[]; // last few turns, session-scoped (not persisted)
}
