// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlinePostWorkbench } from "@/components/app/results/InlinePostWorkbench";
import { PublishDialog } from "@/components/app/results/PublishDialog";
import { DraftDecisionSupport } from "@/components/app/results/DraftDecisionSupport";
import { ResultsView } from "@/components/app/ResultsView";
import { initialFlowState } from "@/hooks/launchFlowReducer";
import { DEMO_PROJECT } from "@/lib/demo";
import { researchContextKey } from "@/lib/opportunityResearch";
import { defaultSuccessContract } from "@/lib/successContract";
import type { PlannedExperiment, TrialOpportunitySnapshot } from "@/lib/types";

afterEach(() => vi.unstubAllGlobals());
const contract = defaultSuccessContract("User feedback / conversations");
const profile = { ...DEMO_PROJECT.profile, publisherVoice: "brand" as const };
const currentKey = researchContextKey(
  profile,
  DEMO_PROJECT.facts,
  contract,
  DEMO_PROJECT.url
);
const trial: TrialOpportunitySnapshot = {
  researchId: "trial-kit",
  contextKey: currentKey,
  mode: "product-led",
  factIds: ["tagline"],
  audience: "Developers",
  task: "Review one sample job",
  entryUrl: "https://cronwise.dev/demo",
  steps: ["Open the sample", "Review its status", "Report a confusing step"],
  feedbackQuestion: "Which step was unclear?",
  rulesUserCheckedAt: "2026-10-25T00:00:00Z",
};
const plan: PlannedExperiment = {
  id: "trial-plan",
  templateId: "trial-template",
  sourceExperimentId: "trial:trial-kit",
  platformId: "twitter",
  platformName: "X / Twitter",
  venue: "Own X profile",
  angle: trial.task,
  variable: "exploratory",
  heldConstant: "No controlled comparison",
  status: "ready",
  postIdx: 0,
  createdAt: "2026-10-25T00:00:00Z",
  opportunity: trial,
};
const content = {
  ...DEMO_PROJECT.result.content[0],
  platformId: "twitter",
  platformName: "X / Twitter",
  posts: [
    {
      ...DEMO_PROJECT.result.content[0].posts[0],
      hook: "Try one sample task.",
      body: `Review a sample job and tell us which step was unclear.\n\n${trial.entryUrl}`,
    },
  ],
};
const inlineProps = (): ComponentProps<typeof InlinePostWorkbench> => ({
  content,
  profile,
  facts: DEMO_PROJECT.facts,
  successContract: contract,
  posted: {},
  loading: false,
  onUpdatePost: vi.fn(),
  onRegenerate: vi.fn(),
  onPublish: vi.fn(),
  onAskCopilot: vi.fn(),
  onOpenLibrary: vi.fn(),
  productUrl: DEMO_PROJECT.url,
  plan,
  trialPlans: [plan],
  currentTrialContextKey: currentKey,
});

async function mountInline(
  patch: Partial<ComponentProps<typeof InlinePostWorkbench>> = {}
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props = { ...inlineProps(), ...patch };
  const render = async (next: Partial<typeof props> = {}) => {
    Object.assign(props, next);
    await act(async () => root.render(createElement(InlinePostWorkbench, props)));
  };
  await render();
  const button = (label: string) => {
    const item = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === label
    );
    if (!item) throw new Error(`Missing button ${label}`);
    return item;
  };
  return {
    container,
    props,
    render,
    button,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("reviewed product-trial draft exits", () => {
  it("does not show a green passed notice when the trial editorial gate blocks", async () => {
    const ui = await mountInline({
      content: {
        ...content,
        posts: [
          {
            ...content.posts[0],
            body: `${content.posts[0].body}\n\n[tagline]`,
          },
        ],
      },
    });
    try {
      expect(ui.container.textContent).toContain("Internal evidence IDs");
      expect(ui.container.textContent).not.toContain("Truth check passed");
      expect(ui.button("Copy draft").disabled).toBe(true);
      expect(ui.button("I published it →").disabled).toBe(true);
    } finally {
      await ui.close();
    }
  });
  it("selects an appended reviewed invitation without claiming a hook-only change", async () => {
    const ui = await mountInline({ plan: undefined, trialPlans: [] });
    try {
      const appended = {
        ...content.posts[0],
        hook: "Try a different sample workflow.",
        body: `Open the product trial and share one confusing step.\n\n${trial.entryUrl}`,
      };
      await ui.render({
        content: { ...content, posts: [content.posts[0], appended] },
        trialPlans: [{ ...plan, postIdx: 1 }],
      });
      expect(ui.container.textContent).toContain("Reviewed trial selected");
      expect(ui.container.textContent).toContain(appended.body);
      expect(ui.container.textContent).not.toContain("Variable changed · Hook");
      expect(ui.container.textContent).not.toContain("New variant selected");
      await act(async () => ui.button("I published it →").click());
      expect(ui.props.onPublish).toHaveBeenCalledWith("twitter", 1);
    } finally {
      await ui.close();
    }
  });

  it("allows Copy and X handoff for the matching current trial without recording publication", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const ui = await mountInline();
    try {
      expect(ui.button("Copy draft").disabled).toBe(false);
      expect(ui.button("Send draft to X composer ↗").disabled).toBe(false);
      expect(ui.button("Copy X thread").disabled).toBe(true);
      expect(ui.button("Copy LinkedIn version").disabled).toBe(true);
      expect(ui.container.textContent).toContain(
        "derived Share Kit versions are not approved trial drafts"
      );
      await act(async () => ui.button("Copy draft").click());
      expect(writeText).toHaveBeenCalledWith(
        `${content.posts[0].hook}\n\n${content.posts[0].body}`
      );
      await act(async () => ui.button("Send draft to X composer ↗").click());
      expect(new URL(String(open.mock.calls[0][0])).searchParams.get("text")).toContain(
        trial.entryUrl
      );
      expect(ui.props.onPublish).not.toHaveBeenCalled();
      expect(ui.props.posted).toEqual({});
    } finally {
      open.mockRestore();
      await ui.close();
    }
  });

  it("blocks draft exits when a fact changes under the same fact ID", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const ui = await mountInline();
    try {
      const changedFacts = DEMO_PROJECT.facts.map((fact) =>
        fact.id === "tagline"
          ? { ...fact, claim: "Changed product scope", evidence: "Changed product scope" }
          : fact
      );
      expect(changedFacts.map((fact) => fact.id)).toEqual(
        DEMO_PROJECT.facts.map((fact) => fact.id)
      );
      await ui.render({
        facts: changedFacts,
        currentTrialContextKey: researchContextKey(
          profile,
          changedFacts,
          contract,
          DEMO_PROJECT.url
        ),
      });
      for (const label of [
        "Copy draft",
        "Send draft to X composer ↗",
        "I published it →",
        "Copy X thread",
        "Copy LinkedIn version",
      ]) {
        expect(ui.button(label).disabled).toBe(true);
        await act(async () => ui.button(label).click());
      }
      expect(ui.container.textContent).toContain(
        "Product facts or the success goal changed"
      );
      expect(writeText).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(ui.props.onPublish).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      await ui.close();
    }
  });

  it("blocks Copy and Open when an edited draft replaces the approved trial entry", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const ui = await mountInline();
    try {
      await ui.render({
        content: {
          ...content,
          posts: [
            {
              ...content.posts[0],
              body: "Try the sample here: https://cronwise.dev/another-entry",
            },
          ],
        },
      });
      expect(ui.button("Copy draft").disabled).toBe(true);
      expect(ui.button("Send draft to X composer ↗").disabled).toBe(true);
      expect(ui.button("I published it →").disabled).toBe(true);
      expect(ui.container.textContent).toContain("entry link that you did not approve");
      await act(async () => ui.button("Send draft to X composer ↗").click());
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      await ui.close();
    }
  });

  it("checks the selected draft identity instead of inheriting the primary plan's stale context", async () => {
    const stalePrimary: PlannedExperiment = {
      ...plan,
      heldConstant: "Primary comparison boundary",
      opportunity: { ...trial, contextKey: "outdated-context" },
    };
    const secondPlan: PlannedExperiment = {
      ...plan,
      id: "second-trial-plan",
      postIdx: 1,
      heldConstant: "Second comparison boundary",
    };
    const ui = await mountInline({
      content: {
        ...content,
        posts: [
          content.posts[0],
          { ...content.posts[0], hook: "Another small sample task." },
        ],
      },
      plan: stalePrimary,
      trialPlans: [stalePrimary, secondPlan],
    });
    try {
      expect(ui.button("Copy draft").disabled).toBe(true);
      await act(async () => ui.button("B").click());
      expect(ui.container.textContent).toContain("Second comparison boundary");
      expect(ui.container.textContent).not.toContain("Primary comparison boundary");
      expect(ui.button("Copy draft").disabled).toBe(false);
      expect(ui.button("Send draft to X composer ↗").disabled).toBe(false);
      await act(async () => ui.button("I published it →").click());
      expect(ui.props.onPublish).toHaveBeenCalledWith("twitter", 1);
      await act(async () => ui.button("A").click());
      expect(ui.button("Copy draft").disabled).toBe(true);
    } finally {
      await ui.close();
    }
  });
});

describe("source-free trial publish confirmation", () => {
  it("rechecks a stale trial when switching from an ordinary draft inside the popup", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onConfirm = vi.fn();
    try {
      await act(async () =>
        root.render(
          createElement(PublishDialog, {
            content: {
              ...content,
              posts: [
                { ...content.posts[0], body: "Review one ordinary sample task." },
                content.posts[0],
              ],
            },
            facts: DEMO_PROJECT.facts,
            profile,
            successContract: contract,
            defaultPostIdx: 0,
            trialPlans: [
              {
                ...plan,
                postIdx: 1,
                opportunity: { ...trial, contextKey: "older-facts" },
                successContract: { ...contract, minimumResult: 7 },
              },
            ],
            currentTrialContextKey: currentKey,
            onConfirm,
            onClose: vi.fn(),
          })
        )
      );
      const confirm = () =>
        [...container.querySelectorAll("button")].find(
          (item) => item.textContent === "Start tracking"
        );
      expect(confirm()?.disabled).toBe(false);
      const select = container.querySelector("select");
      if (!select) throw new Error("Missing draft selector");
      await act(async () => {
        select.value = "1";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(confirm()?.disabled).toBe(true);
      expect(container.textContent).toContain("Product facts only (tagline)");
      expect(container.textContent).toContain("≥ 7 by 72h");
      expect(container.textContent).toContain("Product facts or the success goal changed");
      await act(async () => confirm()?.click());
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("disables repeat confirmation while a recording is pending", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onConfirm = vi.fn();
    try {
      await act(async () =>
        root.render(
          createElement(PublishDialog, {
            content,
            facts: DEMO_PROJECT.facts,
            profile,
            defaultPostIdx: 0,
            trial,
            currentTrialContextKey: currentKey,
            recording: true,
            onConfirm,
            onClose: vi.fn(),
          })
        )
      );
      const button = [...container.querySelectorAll("button")].find(
        (item) => item.textContent === "Recording…"
      );
      expect(button?.disabled).toBe(true);
      await act(async () => {
        button?.click();
        button?.click();
      });
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("renders honest product provenance and refuses a stale publish confirmation", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const props: ComponentProps<typeof PublishDialog> = {
      content,
      facts: DEMO_PROJECT.facts,
      profile,
      successContract: contract,
      defaultPostIdx: 0,
      initialCommunity: plan.venue,
      initialAngle: plan.angle,
      trial,
      currentTrialContextKey: currentKey,
      onConfirm: vi.fn(),
      onClose: vi.fn(),
    };
    const render = async (patch: Partial<typeof props> = {}) => {
      Object.assign(props, patch);
      await act(async () => root.render(createElement(PublishDialog, props)));
    };
    try {
      await render();
      expect(container.textContent).toContain("Product facts only (tagline)");
      expect(container.textContent).toContain(
        "No external demand evidence or venue permission verified"
      );
      expect(container.textContent).not.toContain("Demand source:");
      const confirm = () => {
        const button = [...container.querySelectorAll("button")].find(
          (node) => node.textContent === "Start tracking"
        );
        if (!button) throw new Error("Missing publish confirmation");
        return button;
      };
      expect(confirm().disabled).toBe(false);
      await render({ currentTrialContextKey: "new-facts-same-ids" });
      expect(confirm().disabled).toBe(true);
      expect(container.textContent).toContain("prepare a fresh trial kit");
      await act(async () => confirm().click());
      expect(props.onConfirm).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

describe("publish receipt waits for canonical workspace acceptance", () => {
  it("does not announce success when the parent rejects the publish callback", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onPublishExperiment = vi.fn();
    const props: ComponentProps<typeof ResultsView> = {
      result: { content: [content], schedule: [] },
      strategy: DEMO_PROJECT.strategy,
      profile,
      facts: DEMO_PROJECT.facts,
      analysisReceipt: null,
      workspace: {
        experiments: [],
        taskLog: [],
        successContract: contract,
        plannedExperiments: [plan],
      },
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
      onPublishExperiment,
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
      growthAgent: {
        runs: [],
        enabled: false,
        checking: false,
        error: "",
        busy: false,
        refresh: vi.fn(),
        start: vi.fn(),
        resume: vi.fn(),
        cancel: vi.fn(),
      },
      onReviewAgent: vi.fn(),
      projectId: "qa-project",
      onCompleteSetup: vi.fn(),
      onSaveProject: vi.fn(),
    };
    const render = async () =>
      act(async () => root.render(createElement(ResultsView, props)));
    const button = (label: string) => {
      const node = [...container.querySelectorAll("button")].find(
        (item) => item.textContent === label
      );
      if (!node) throw new Error(`Missing button ${label}`);
      return node;
    };
    try {
      await render();
      await act(async () => button("I published it →").click());
      await act(async () => button("Start tracking").click());
      expect(onPublishExperiment).toHaveBeenCalledTimes(1);
      expect(container.textContent).not.toContain("X / Twitter experiment started");
      expect(button("Recording…").disabled).toBe(true);
      await act(async () => button("Recording…").click());
      expect(onPublishExperiment).toHaveBeenCalledTimes(1);
      const accepted = onPublishExperiment.mock.calls[0][0];
      props.workspace = { ...props.workspace, experiments: [accepted] };
      await render();
      expect(container.textContent).toContain("X / Twitter experiment started");
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

describe("derived Share Kit exit gate", () => {
  it("shows external issues and disables both derived-copy actions without hiding screenshot work", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          createElement(DraftDecisionSupport, {
            content,
            facts: DEMO_PROJECT.facts,
            post: content.posts[0],
            profile,
            productUrl: DEMO_PROJECT.url,
            externalIssues: ["The approved trial entry has changed"],
          })
        )
      );
      expect(container.textContent).toContain("The approved trial entry has changed");
      expect(container.textContent).toContain("screenshot instructions");
      for (const label of ["Copy X thread", "Copy LinkedIn version"]) {
        const button = [...container.querySelectorAll("button")].find(
          (node) => node.textContent === label
        );
        expect(button?.disabled).toBe(true);
        await act(async () => button?.click());
      }
      expect(writeText).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
