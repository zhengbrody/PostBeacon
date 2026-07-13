export type Provider = "claude" | "openai" | "deepseek";

/** How grounded a model's conclusion is vs. inferred from a thin page. */
export type Confidence = "high" | "medium" | "low";

// ---- Fact Ledger (M13): every claim carries provenance ----

/**
 * observed       — evidence quote verified against the scraped page BY CODE.
 * user-confirmed — set only by an explicit user action, never by the model.
 * inferred       — model conclusion without verifying evidence.
 * unknown        — the source doesn't say; must not be filled by guessing.
 */
export type FactStatus = "observed" | "user-confirmed" | "inferred" | "unknown";
export type FactSourceType = "page" | "user" | "model" | "search";

export interface Fact {
  id: string;
  field?: string; // profile field this fact backs (name/audience/stage/…)
  claim: string; // "" when unknown
  evidence?: string; // verbatim page quote — required for observed
  sourceUrl?: string;
  sourceType: FactSourceType;
  status: FactStatus;
  confidence: number; // 0..1
  lastVerifiedAt: string; // ISO — evidence verified / user confirmed
}

/** One of the ≤3 high-value questions asked when key context is missing. */
export interface ClarifyingQuestion {
  id: "stage" | "conversionGoal" | "assets";
  question: string;
  why: string; // what the answer unlocks in the plan
  options?: string[]; // quick-pick chips; free text always allowed
}

// ---- Output provenance (M13): who produced this, with which prompt, when ----

export interface GenerationMeta {
  provider: Provider;
  model: string;
  promptVersion: string;
  generatedAt: string; // ISO
}

export interface GenerationFailure {
  platformId: string;
  platformName: string;
  error: string; // user-safe message
}

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
  // --- launch context (M13) — usually unknown from the page; filled by the
  // --- clarifying questions, never by model guesses.
  stage?: string; // where the product is right now (pre-launch / launched / growing)
  conversionGoal?: string; // the single conversion that matters most right now
  assets?: string; // existing audience / assets / constraints
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
  meta?: GenerationMeta; // M13 — provider/model/promptVersion/time of this output
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
  failures?: GenerationFailure[]; // M13 — channels that failed (individually retryable)
}

export type Priority = "high" | "medium" | "low";

// ---- Explainable scoring (M13): the model rates dimensions with reasons; the
// ---- total and priority are computed deterministically in code (lib/scoring.ts).

export interface ScoreDimension {
  score: number; // 0..10
  reason: string; // grounded one-liner
  evidence?: string; // supporting quote/fact text
  factIds?: string[]; // ledger facts this rating leans on
}

export type ScoreDimensionKey =
  | "audienceFit" // is this product's audience actually here
  | "intentFit" // are they here with intent this product can catch
  | "nativeContentFit" // does the product make content natives upvote
  | "founderAccess" // can THIS founder credibly show up here
  | "effort" // code-derived from the catalog (cost, inverted in the total)
  | "risk" // 10 = most likely to get flagged/buried (inverted in the total)
  | "evidenceQuality"; // code-derived from fact grounding

export type ScoreBreakdown = Record<ScoreDimensionKey, ScoreDimension>;

export interface PlatformRecommendation {
  platformId: string;
  platformName: string;
  score: number; // 0-100 — computed by code from the breakdown (never by the model)
  priority: Priority; // derived from score thresholds in code
  effort?: "low" | "medium" | "high"; // attached from the platform catalog
  confidence?: Confidence; // the model's confidence in this fit call
  rationale: string; // why this platform, for this product
  angle: string; // the specific marketing angle to use here
  bestMove?: string; // the single highest-leverage action on this channel
  breakdown?: ScoreBreakdown; // M13 — per-dimension scores + reasons (absent on legacy saves)
  venue?: string; // M13 — the exact community/venue the bestMove targets
  sources?: string[]; // M13 — grounding URLs (only ever from validated discoveries)
  provenance?: "grounded" | "inferred"; // M13 — "grounded" only with real sources
  fallback?: boolean; // M13 — deterministic placeholder (model never assessed it)
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
  meta?: GenerationMeta; // M13 — provider/model/promptVersion/time of this plan
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

export interface CopilotRequest {
  provider?: Provider;
  profile: ProductProfile;
  strategy: MarketingStrategy;
  result?: GenerateResult | null;
  facts?: Fact[]; // M13 — the copilot answers with the same provenance discipline
  workspace?: WorkspaceState; // M16 — experiments + outcomes for evidence refs
  memory?: ProductMemory; // M16 — lean product memory in the context
  launchDate?: string;
  action: CopilotAction;
  question?: string; // free question / rewrite direction / pasted feedback
  targetPlatformId?: string; // required for "rewrite" and "first-replies"
  history?: CopilotMessage[]; // last few turns, session-scoped (not persisted)
}

// ---- Launch workspace (M15): the continuing loop after the plan ----
// PostBeacon NEVER auto-posts. Experiments record what the founder published
// by hand; outcomes are typed or pasted in; verdicts are computed in code.

export type ExperimentStatus = "live" | "analyzed" | "stopped";
export type OutcomeCheckpoint = "24h" | "72h" | "manual";
export type VerdictCall = "supported" | "promising" | "weak" | "no-signal";

/** One check-in's results. Absent numbers mean "not measured", never 0. */
export interface Outcome {
  id: string;
  checkpoint: OutcomeCheckpoint;
  recordedAt: string; // ISO
  impressions?: number;
  replies?: number;
  clicks?: number;
  signups?: number;
  revenue?: number;
  qualitativeFeedback?: string; // typed or pasted — comments, DMs, notes
}

/** The code-computed read on an experiment (rule-based, explainable). */
export interface ExperimentVerdict {
  call: VerdictCall;
  reason: string; // the rule that fired, in plain language
  advice: string; // continue/stop + which angle/channel
  decidedAt: string; // ISO — a completed learning loop counts from here
}

/** One hand-published post being tracked. Created by the Publish dialog. */
export interface Experiment {
  id: string;
  platformId: string;
  platformName: string;
  community: string; // e.g. "r/selfhosted"
  angle: string;
  variant: string; // the hook actually used
  hypothesis: string;
  trackedUrl?: string;
  publishedAt: string; // ISO
  status: ExperimentStatus;
  postIdx: number; // which draft was published
  outcomes: Outcome[];
  verdict?: ExperimentVerdict;
}

/** A Today card the user acted on (done/skipped). Cards themselves are
 *  derived fresh each render; only actions taken are stored. */
export interface TaskRecord {
  id: string; // the derived card's stable id
  kind: "post" | "record" | "custom";
  title: string;
  status: "done" | "skipped";
  estMinutes: number;
  at: string; // ISO
}

/** Everything the workspace persists beyond the plan itself. */
export interface WorkspaceState {
  weeklyMinutes?: number; // intake: weekly time budget
  experiments: Experiment[];
  taskLog: TaskRecord[];
  auditLog?: AuditEntry[]; // M16 — copilot proposals and their fates (≤100)
}

// ---- Copilot action engine (M16): the model proposes, the user disposes ----

export type CopilotTool =
  | "ask_clarifying_question"
  | "propose_next_actions"
  | "update_positioning"
  | "update_channel_priority"
  | "create_experiment"
  | "generate_variant"
  | "record_outcome"
  | "diagnose_outcome"
  | "stop_or_continue_channel";

/** A pointer at a real plan object. Server-verified — refs that don't
 *  resolve are dropped and counted, never displayed as evidence. */
export interface EvidenceRef {
  type: "fact" | "experiment" | "recommendation" | "post" | "memory";
  id: string; // fact id · experiment id · platformId · `${platformId}#${idx}` · mem key
}

interface ProposedBase {
  id: string; // assigned at validation time — audit entries correlate on it
  rationale: string;
  evidence: EvidenceRef[]; // verified refs only
  droppedEvidence: number; // refs the model cited that didn't resolve
  confidence: "grounded" | "unknown"; // computed from verified evidence, never model-claimed
  /** When confidence is unknown, the model is told to propose how to find out. */
  validationExperiment?: {
    platformId: string;
    community: string;
    angle: string;
    hypothesis: string;
  };
}

export type ProposedAction = ProposedBase &
  (
    | { tool: "ask_clarifying_question"; question: string; why: string; options?: string[] }
    | {
        tool: "propose_next_actions";
        items: { title: string; whyNow: string; estMinutes: number; platformId?: string }[];
      }
    | { tool: "update_positioning"; positioning?: string; antiPositioning?: string }
    | { tool: "update_channel_priority"; platformId: string; priority: Priority }
    | {
        tool: "create_experiment";
        platformId: string;
        community: string;
        angle: string;
        hypothesis: string;
        postIdx?: number;
      }
    | {
        tool: "generate_variant";
        platformId: string;
        postIdx?: number;
        direction?: string;
        hook?: string;
        body?: string;
      }
    | { tool: "record_outcome"; experimentId: string; checkpoint: "24h" | "72h" | "manual" }
    | {
        tool: "diagnose_outcome";
        experimentId: string;
        diagnosis: string;
        suggestion: string;
      }
    | {
        tool: "stop_or_continue_channel";
        platformId: string;
        decision: "stop" | "continue";
      }
  );

/** What the copilot endpoint returns now: prose + proposals, never mutations. */
export interface CopilotReplyV2 {
  reply: string;
  actions: ProposedAction[];
  blocked: number; // schema-invalid / unknown-id proposals dropped server-side
}

// ---- Product Memory (M16): persistent, lean — never the chat transcript ----

export interface AngleRecord {
  angle: string;
  platformId: string;
  verdict: "winning" | "losing";
  experimentId: string; // the evidence
  at: string;
}

export interface RewriteFeedback {
  platformId: string;
  direction: "accepted" | "rejected";
  summary: string; // short label, never the full text
  at: string;
}

export interface ProductMemory {
  tone?: string; // preferred writing tone (user-editable)
  bannedClaims: string[]; // things never to claim (≤20)
  angles: AngleRecord[]; // auto-appended when verdicts land (≤20)
  rewriteFeedback: RewriteFeedback[]; // accepted/rejected variants (≤30)
  userEditedFields: string[]; // hand-edited plan fields → overwrite needs double confirm
}

/** One audited copilot decision. Applied entries also surface on the Timeline. */
export interface AuditEntry {
  id: string; // the proposal's id
  at: string;
  tool: CopilotTool | "unknown";
  summary: string;
  decision: "applied" | "rejected" | "blocked";
  destructive: boolean;
  evidenceVerified: number;
  evidenceCited: number;
}
