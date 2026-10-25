import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentRunPanel } from "@/components/app/results/AgentRunPanel";
import { ResultsView } from "@/components/app/ResultsView";
import { DEMO_PROJECT } from "@/lib/demo";
import { initialFlowState } from "@/hooks/launchFlowReducer";
import type { GrowthAgentControls } from "@/hooks/useGrowthAgent";
import type { AgentRun } from "@/lib/agentRuns";

const controls = (): GrowthAgentControls => ({
  runs: [],
  enabled: true,
  checking: false,
  error: "",
  busy: false,
  refresh: vi.fn(),
  start: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
});
describe("visible Agent entry and honest receipts", () => {
  it("shows missing legacy setup instead of silently hiding the Agent", () => {
    const props: ComponentProps<typeof ResultsView> = {
      result: DEMO_PROJECT.result,
      strategy: DEMO_PROJECT.strategy,
      profile: DEMO_PROJECT.profile,
      facts: DEMO_PROJECT.facts,
      analysisReceipt: null,
      workspace: { experiments: [], taskLog: [] },
      memory: initialFlowState.memory,
      posted: {},
      launchDate: "",
      setLaunchDate: vi.fn(),
      loading: false,
      demo: false,
      onReset: vi.fn(),
      onAskCopilot: vi.fn(),
      emailRemindersAvailable: false,
      onToggleEmailReminders: vi.fn(),
      onTogglePosted: vi.fn(),
      onRegenerate: vi.fn(),
      onUpdatePost: vi.fn(),
      onUpdateStrategy: vi.fn(),
      onUpdateRecommendation: vi.fn(),
      onUpdateScheduleItem: vi.fn(),
      onRemoveScheduleItem: vi.fn(),
      onAddScheduleItem: vi.fn(),
      onRemoveChannel: vi.fn(),
      onAddChannel: vi.fn(),
      onRetryFailed: vi.fn(),
      onActTask: vi.fn(),
      onPublishExperiment: vi.fn(),
      onRecordOutcome: vi.fn(),
      onStopExperiment: vi.fn(),
      onGenerateVariant: vi.fn(),
      onPlanExperiment: vi.fn(),
      onPreparePlanned: vi.fn(),
      onCancelPlanned: vi.fn(),
      productUrl: DEMO_PROJECT.url,
      provider: "openai",
      onResearchOpportunities: vi.fn(),
      onClearOpportunityResearch: vi.fn(),
      onQueueOpportunity: vi.fn(),
      growthAgent: controls(),
      onReviewAgent: vi.fn(),
      projectId: "project",
      onCompleteSetup: vi.fn(),
      onSaveProject: vi.fn(),
    };
    const html = renderToStaticMarkup(createElement(ResultsView, props));
    expect(html).toContain("Growth Agent");
    expect(html).toContain("Complete experiment setup");
    expect(html).not.toContain("Start one research task");
  });
  it("does not label a skipped model step as a completed request", () => {
    const run: AgentRun = {
      id: "example",
      projectId: "project",
      status: "ready",
      phase: "ready",
      provider: "openai",
      createdAt: "2026-10-24T00:00:00Z",
      updatedAt: "2026-10-24T00:00:01Z",
      interrupted: false,
      canResume: false,
      modelAttempted: false,
      sourceCount: 1,
      checkedSources: 1,
      input: {
        audience: "Developers",
        task: "Review one sample",
        platformId: "twitter",
        venue: "Own X profile",
        entryUrl: "https://example.org/demo",
        steps: ["Open", "Review", "Reply"],
        feedbackQuestion: "What was unclear?",
        sources: [],
      },
    };
    const html = renderToStaticMarkup(
      createElement(AgentRunPanel, {
        agent: { ...controls(), runs: [run] },
        onReview: vi.fn(),
      })
    );
    expect(html).toContain("not needed");
    expect(html).toContain("No model request reserved");
    expect(html).not.toContain("One model request · recorded");
  });
  it("shows disabled deployment honestly, without fake task progress", () => {
    const html = renderToStaticMarkup(
      createElement(AgentRunPanel, {
        agent: { ...controls(), enabled: false },
        onReview: vi.fn(),
      })
    );
    expect(html).toContain("not enabled");
    expect(html).toContain("No model will be called");
    expect(html).not.toContain("aria-current");
  });
});
