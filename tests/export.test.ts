import { describe, expect, it } from "vitest";
import { toJson, toMarkdown, type ExportSnapshot } from "@/lib/export";
import type {
  PlannedExperiment,
  TrialOpportunitySnapshot,
  WorkspaceState,
} from "@/lib/types";
import { timelineEvents } from "@/lib/today";

const workspace: WorkspaceState = {
  successContract: {
    primaryGoal: "Free signups / installs",
    primarySignal: "signups",
    baseline: 1,
    minimumResult: 2,
    evaluationWindow: "72h",
  },
  experiments: [
    {
      id: "e1",
      platformId: "reddit",
      platformName: "Reddit",
      community: "r/selfhosted",
      angle: "the angle",
      variant: "v1",
      hypothesis: "this converts",
      publishedAt: "2026-07-10T09:00:00.000Z",
      status: "analyzed",
      postIdx: 0,
      successContract: {
        primaryGoal: "Free signups / installs",
        primarySignal: "signups",
        baseline: 1,
        minimumResult: 2,
        evaluationWindow: "72h",
      },
      outcomes: [
        {
          id: "o1",
          checkpoint: "24h",
          recordedAt: "2026-07-11T09:00:00.000Z",
          impressions: 1200,
          replies: 8,
          signups: 2,
          qualitativeFeedback: "asked about pricing",
          verdict: {
            call: "supported",
            reason: "It converted",
            advice: "keep going",
            decidedAt: "2026-07-11T09:00:00.000Z",
          },
        },
      ],
      verdict: {
        call: "supported",
        reason: "It converted",
        advice: "keep going",
        decidedAt: "2026-07-11T09:00:00.000Z",
      },
    },
  ],
  taskLog: [],
};

const snap: ExportSnapshot = {
  profile: null,
  strategy: null,
  result: { content: [], schedule: [] },
  workspace,
  memory: {
    tone: "dry",
    bannedClaims: ["AI-powered"],
    angles: [],
    rewriteFeedback: [],
    userEditedFields: [],
  },
};

describe("plan export carries the learning loop (anonymous users' only way out)", () => {
  it("exports source-free product-led approvals honestly in queue and history", () => {
    const trial: TrialOpportunitySnapshot = {
      researchId: "product-trial",
      mode: "product-led",
      contextKey: "saved-context",
      factIds: ["feature-a", "feature-b"],
      audience: "Developers",
      task: "Try one documented workflow",
      entryUrl: "https://example.org/demo",
      steps: ["Open the demo", "Try the sample", "Report one confusing step"],
      feedbackQuestion: "Which step was unclear?",
      rulesUserCheckedAt: "2026-10-25T00:00:00Z",
    };
    const planned: PlannedExperiment = {
      id: "planned-product-trial",
      templateId: "trial-template",
      sourceExperimentId: "trial:product-trial",
      platformId: "twitter",
      platformName: "X / Twitter",
      venue: "Own X profile",
      angle: "Product trial",
      variable: "hook",
      heldConstant: "Audience and task",
      status: "ready",
      createdAt: "2026-10-25T00:00:00Z",
      opportunity: trial,
    };
    const current: WorkspaceState = {
      ...workspace,
      plannedExperiments: [planned],
      experiments: workspace.experiments.map((experiment) => ({
        ...experiment,
        opportunity: trial,
      })),
    };
    const md = toMarkdown({ ...snap, workspace: current });
    expect(md).toContain("Mode: product-led; no external demand evidence");
    expect(md).toContain("*Trial mode:* product-led; no external demand evidence");
    expect(md).toContain("feature-a, feature-b");
    expect(md).not.toContain("Demand excerpt:");
    expect(md).not.toContain("undefined");
    const timeline = timelineEvents(current).find((event) =>
      event.text.includes("Next experiment confirmed")
    );
    expect(timeline?.text).toContain("Product-led trial; no external demand evidence");
    expect(timeline?.text).toContain("feature-a, feature-b");
    expect(
      JSON.parse(toJson({ ...snap, workspace: current })).workspace.plannedExperiments[0]
        .opportunity.source
    ).toBeUndefined();
  });

  it("does not reconstruct an unavailable historical demand source", () => {
    const trial: TrialOpportunitySnapshot = {
      researchId: "old-trial",
      audience: "Developers",
      task: "Try a task",
      entryUrl: "https://example.org/demo",
      steps: ["Open", "Try", "Reply"],
      feedbackQuestion: "What was unclear?",
      rulesUserCheckedAt: "2026-10-25T00:00:00Z",
    };
    const md = toMarkdown({
      ...snap,
      workspace: {
        ...workspace,
        experiments: workspace.experiments.map((experiment) => ({
          ...experiment,
          opportunity: trial,
        })),
      },
    });
    expect(md).toContain("Trial source:* unavailable; not reconstructed");
    expect(md).not.toContain("undefined");
  });
  it("markdown includes the experiment log with metrics, feedback and verdict", () => {
    const md = toMarkdown(snap);
    expect(md).toContain("## Experiment log");
    expect(md).toContain("Reddit · r/selfhosted — 2026-07-10 (analyzed)");
    expect(md).toContain("*Hypothesis:* this converts");
    expect(md).toContain("**24h**: 1200 impressions · 8 replies · 2 signups");
    expect(md).toContain("asked about pricing");
    expect(md).toContain("**Verdict:** supported — It converted");
    expect(md).toContain("## Experiment success contract");
    expect(md).toContain("Signups / installs ≥ 2 by 72h");
    expect(md).toContain("*Success contract:* Signups / installs ≥ 2 by 72h");
  });

  it("markdown omits the section when nothing was published", () => {
    expect(toMarkdown({ ...snap, workspace: undefined })).not.toContain(
      "## Experiment log"
    );
    expect(
      toMarkdown({ ...snap, workspace: { experiments: [], taskLog: [] } })
    ).not.toContain("## Experiment log");
  });

  it("labels a legacy experiment-only verdict without inventing its checkpoint", () => {
    const legacy: WorkspaceState = {
      ...workspace,
      experiments: workspace.experiments.map((experiment) => ({
        ...experiment,
        outcomes: experiment.outcomes.map(({ verdict: _verdict, ...outcome }) => outcome),
      })),
    };
    const md = toMarkdown({ ...snap, workspace: legacy });
    expect(md).toContain("**Historical final verdict:** supported");
    expect(md).toContain("checkpoint unavailable");
  });

  it("json round-trips workspace and memory", () => {
    const parsed = JSON.parse(toJson(snap)) as ExportSnapshot;
    expect(parsed.workspace?.experiments).toHaveLength(1);
    expect(parsed.workspace?.successContract?.minimumResult).toBe(2);
    expect(parsed.memory?.bannedClaims).toEqual(["AI-powered"]);
  });

  it("exports the bounded analysis receipt without page content", () => {
    const analysisReceipt = {
      completedAt: "2026-08-04T00:00:00.000Z",
      sources: [
        {
          kind: "primary" as const,
          requestedUrl: "example.com",
          canonicalUrl: "https://example.com/",
          status: "fetched" as const,
          method: "static" as const,
        },
      ],
      checks: {
        urlsValidated: 1,
        pagesFetched: 1,
        factsExtracted: 3,
        claimsVerified: 2,
        claimsInferred: 1,
        claimsUnknown: 0,
        claimsDemoted: 0,
      },
      foundAreas: ["features"],
      notFoundAreas: ["pricing"],
      provider: {
        provider: "openai" as const,
        model: "test",
        promptVersion: "a5",
        generatedAt: "2026-08-04T00:00:00.000Z",
      },
      limitation: "Only submitted extracts were checked.",
    };
    const md = toMarkdown({ ...snap, analysisReceipt });
    expect(md).toContain("## Analysis receipt");
    expect(md).toContain("2 verified · 1 inferred · 0 unknown");
    expect(md).toContain("https://example.com/");
  });
});
