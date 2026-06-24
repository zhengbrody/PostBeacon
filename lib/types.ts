export type Provider = "claude" | "openai" | "deepseek";

export interface ProductProfile {
  name: string;
  tagline: string;
  valueProp: string;
  audience: string;
  differentiators: string[];
  features: string[];
  tone: string;
  category: string;
}

export interface PlatformPost {
  hook: string; // headline / first line — the thing that decides life or death
  body: string;
  imageSuggestion: string;
  bestTime: string;
  caveats: string; // platform-specific do-nots
}

export interface PlatformContent {
  platformId: string;
  platformName: string;
  posts: PlatformPost[];
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
  rationale: string; // why this platform, for this product
  angle: string; // the specific marketing angle to use here
}

export interface MarketingStrategy {
  positioning: string; // the core narrative to lead with everywhere
  overallStrategy: string; // the CMO's plan in a few sentences
  recommendations: PlatformRecommendation[]; // ALL platforms, scored & ranked
  // Phase-2: communities/subreddits/competitor mentions discovered live on the web
  discoveries?: DiscoveredChannel[];
}

export interface DiscoveredChannel {
  name: string;
  url: string;
  why: string;
  source: string; // how it was found
}
