import { flowReducer, initialFlowState } from "@/hooks/launchFlowReducer";
import { isDeepStrictEqual } from "node:util";
import { DEMO_PROJECT } from "@/lib/demo";
import { toJson } from "@/lib/export";
import { trialSafety } from "@/lib/opportunityResearch";
import { migrateDraft } from "@/lib/storage";
import type { runOpportunityResearch } from "@/lib/opportunityResearchServer";
import type {
  Fact,
  ProductProfile,
  SuccessContract,
  TrialResearchInput,
} from "@/lib/types";

type ResearchProvider = "openai" | "deepseek";
type ResearchRunner = typeof runOpportunityResearch;

/** Parse spending consent before loading any local credentials or model modules. */
export function acceptanceProviders(
  env: Record<string, string | undefined>
): ResearchProvider[] {
  if (env.RUN_RESEARCH_ACCEPTANCE !== "1") return [];
  const requested = (env.RESEARCH_ACCEPTANCE_PROVIDERS ?? "openai").split(",");
  if (
    !requested.length ||
    new Set(requested).size !== requested.length ||
    requested.some((p) => p !== "openai" && p !== "deepseek")
  )
    throw new Error("Select OpenAI and/or DeepSeek once each; Claude is excluded.");
  if (requested.includes("deepseek") && env.RESEARCH_ACCEPTANCE_DEEPSEEK_ACK !== "1")
    throw new Error("Explicit DeepSeek data-processing acknowledgement is required.");
  return requested as ResearchProvider[];
}

/** Entire batch preflight: never spend on provider A before discovering B has no key. */
export function preflightAcceptance(
  providers: ResearchProvider[],
  env: Record<string, string | undefined>
) {
  if (env.OPENAI_BASE_URL && env.OPENAI_BASE_URL !== "https://api.openai.com/v1")
    throw new Error("Custom OpenAI endpoints are excluded from this acceptance.");
  for (const provider of providers) {
    if (!env[provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY"]?.trim())
      throw new Error(`No ${provider} key configured; no requests were sent.`);
  }
}

const contract: SuccessContract = {
  primaryGoal: "Useful feedback on a draft workflow",
  primarySignal: "replies",
  minimumResult: 1,
  evaluationWindow: "72h",
};
const facts: Fact[] = [
  {
    id: "manual-draft",
    field: "features",
    claim: "PostBeacon prepares drafts from verified product facts for manual publishing.",
    sourceType: "user",
    status: "user-confirmed",
    confidence: 1,
    lastVerifiedAt: "2026-10-23T00:00:00.000Z",
  },
  {
    id: "conversionGoal",
    field: "conversionGoal",
    claim: contract.primaryGoal,
    sourceType: "user",
    status: "user-confirmed",
    confidence: 1,
    lastVerifiedAt: "2026-10-23T00:00:00.000Z",
  },
];
const profile: ProductProfile = {
  name: "PostBeacon",
  tagline: "One growth experiment at a time",
  valueProp: facts[0].claim,
  audience: "Independent developers",
  differentiators: ["Manual publishing"],
  features: [facts[0].claim],
  tone: "Direct and factual",
  category: "Software",
  publisherVoice: "brand",
  conversionGoal: contract.primaryGoal,
};
const input: TrialResearchInput = {
  audience: "Independent developers reviewing a launch draft",
  task: "Review one draft in the fictional walkthrough",
  entryUrl: "https://postbeacon.app/app?demo=1",
  platformId: "twitter",
  venue: "Operator-controlled acceptance fixture, not a real publishing destination",
  steps: [
    "Open the fictional walkthrough",
    "Review a draft and its evidence",
    "Identify one unclear step",
  ],
  feedbackQuestion: "Which part of reviewing the draft was unclear?",
  sources: [
    {
      url: "https://example.org/postbeacon-acceptance-scenario",
      quote:
        "Controlled acceptance scenario, not customer demand: an independent developer wants to review a factual launch draft before manually publishing it.",
      fetchAllowed: false,
    },
  ],
};

/** Public product description + explicitly hypothetical demand. Never a real customer quote. */
export function acceptanceRequest(
  provider: ResearchProvider
): Parameters<ResearchRunner>[0] {
  return structuredClone({
    provider,
    productUrl: "https://postbeacon.app",
    profile,
    facts,
    successContract: contract,
    input,
  });
}

function localContinuity(
  research: Awaited<ReturnType<ResearchRunner>>,
  opportunityId: string
) {
  const equalJson = (a: unknown, b: unknown) =>
    isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  let state = flowReducer(initialFlowState, {
    type: "PROJECT_LOADED",
    demo: false,
    project: {
      ...DEMO_PROJECT,
      id: "controlled-acceptance-only",
      url: "https://postbeacon.app",
      profile,
      facts,
      result: {
        content: [{ platformId: "twitter", platformName: "X / Twitter", posts: [] }],
        schedule: [],
      },
      workspace: { experiments: [], taskLog: [], successContract: contract },
    },
  });
  state = flowReducer(state, {
    type: "OPPORTUNITY_RESEARCH_RECEIVED",
    projectId: state.projectId,
    research,
  });
  const confirm = {
    type: "OPPORTUNITY_QUEUED" as const,
    researchId: research.id,
    opportunityId,
    rulesUserChecked: true,
    trialUserChecked: true,
    at: new Date().toISOString(),
  };
  const unconfirmed = flowReducer(state, { ...confirm, trialUserChecked: false });
  const acknowledgements = equalJson(unconfirmed, state);
  state = flowReducer(state, confirm);
  const plan = state.workspace.plannedExperiments?.[0];
  const singleDraft = Boolean(
    plan && plan.status === "ready" && state.result?.content[0].posts.length === 1
  );
  const idempotent = equalJson(flowReducer(state, confirm), state);
  const restored = flowReducer(initialFlowState, {
    type: "PROJECT_LOADED",
    demo: false,
    project: { ...state, ...migrateDraft(JSON.parse(toJson(state))) },
  });
  return {
    acknowledgements,
    singleDraft,
    idempotent,
    queueHydration:
      Boolean(plan) && equalJson(restored.workspace.plannedExperiments?.[0], plan),
    receiptHydration: equalJson(restored.workspace.opportunityResearch, research),
    noPublishedExecution: restored.workspace.experiments.length === 0,
  };
}

export interface ResearchAcceptanceReport {
  provider: ResearchProvider;
  model?: string;
  protocol: "passed" | "failed";
  content: "review-ready" | "blocked" | "no-fit" | "not-run";
  localContinuity: "passed" | "failed" | "not-run";
  continuityChecks?: ReturnType<typeof localContinuity>;
  failure?: "provider-provenance" | "research-failed";
  opportunities: number;
  blockedOpportunities: number;
  researchInvocations: 1;
  controlledScenario: true;
  simulatedConfirmation: true;
  productionAccepted: false;
}

/** One orchestration invocation, no retries here. No raw draft, prompt or exception in the report. */
export async function runResearchAcceptance(
  provider: ResearchProvider,
  run: ResearchRunner
): Promise<ResearchAcceptanceReport> {
  const report: ResearchAcceptanceReport = {
    provider,
    protocol: "failed",
    content: "not-run",
    localContinuity: "not-run",
    opportunities: 0,
    blockedOpportunities: 0,
    researchInvocations: 1,
    controlledScenario: true,
    simulatedConfirmation: true,
    productionAccepted: false,
  };
  try {
    const request = acceptanceRequest(provider);
    const research = await run(request);
    if (
      research.meta?.provider !== provider ||
      !/^[a-zA-Z0-9._:-]{1,80}$/.test(research.meta.model)
    )
      return { ...report, failure: "provider-provenance" };
    report.model = research.meta.model;
    report.protocol = "passed";
    report.opportunities = research.opportunities.length;
    const ready = research.opportunities.filter(
      (o) => trialSafety(research, o.id, request.facts, request.profile).length === 0
    );
    report.blockedOpportunities = research.opportunities.length - ready.length;
    report.content = ready.length
      ? "review-ready"
      : research.opportunities.length
        ? "blocked"
        : "no-fit";
    if (ready.length) {
      report.continuityChecks = localContinuity(research, ready[0].id);
      report.localContinuity = Object.values(report.continuityChecks).every(Boolean)
        ? "passed"
        : "failed";
    }
    return report;
  } catch {
    return { ...report, protocol: "failed", failure: "research-failed" };
  }
}
