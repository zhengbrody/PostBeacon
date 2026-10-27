// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpportunityWorkbench } from "@/components/app/results/OpportunityWorkbench";
import { DEMO_PROJECT } from "@/lib/demo";
import { createTrialBrief } from "@/lib/trialBrief";
import { defaultSuccessContract } from "@/lib/successContract";
import { researchContextKey } from "@/lib/opportunityResearch";
import type { OpportunityResearch, PlannedExperiment } from "@/lib/types";

afterEach(() => vi.unstubAllGlobals());
const contract = defaultSuccessContract("User feedback / conversations");
const baseProps = (): ComponentProps<typeof OpportunityWorkbench> => ({
  profile: DEMO_PROJECT.profile,
  facts: DEMO_PROJECT.facts,
  bannedClaims: [],
  contract,
  productUrl: DEMO_PROJECT.url,
  provider: "openai",
  queue: [],
  draftCounts: {},
  loading: false,
  demo: true,
  onResearch: vi.fn(),
  onClear: vi.fn(),
  onQueue: vi.fn(),
  onReviewAgent: vi.fn(),
  agent: {
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
});
const research = (): OpportunityResearch => {
  const input = createTrialBrief(DEMO_PROJECT.profile, DEMO_PROJECT.url);
  return {
    id: "brief-research",
    input,
    contextKey: researchContextKey(
      DEMO_PROJECT.profile,
      DEMO_PROJECT.facts,
      contract,
      DEMO_PROJECT.url
    ),
    sources: [],
    opportunities: [
      {
        id: "trial-1",
        whyFit: "A proposed product trial, not discovered demand.",
        factIds: ["tagline"],
        draft: {
          hook: "Try Cronwise.",
          body: `Know the second a background job silently dies.\n\n${input.entryUrl}`,
          imageSuggestion: "Capture the actual product trial",
          bestTime: "When the user chooses",
          caveats: "Proposed trial, no external demand evidence",
        },
      },
    ],
    completedAt: "2026-10-25T12:00:00Z",
    example: true,
  };
};

async function mount(patch: Partial<ComponentProps<typeof OpportunityWorkbench>> = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props = { ...baseProps(), ...patch };
  await act(async () => root.render(createElement(OpportunityWorkbench, props)));
  const button = (text: string) => {
    const item = [...container.querySelectorAll("button")].find((node) =>
      node.textContent?.includes(text)
    );
    if (!item) throw new Error(`Missing button: ${text}`);
    return item;
  };
  const edit = async (label: string, value: string) => {
    const labelNode = [...container.querySelectorAll("label")].find(
      (node) => node.textContent === label
    );
    const input = labelNode
      ? [...container.querySelectorAll<HTMLInputElement>("input")].find(
          (item) => item.id === labelNode.htmlFor
        )
      : null;
    if (!input) throw new Error(`Missing field: ${label}`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        value
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const close = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return { container, props, root, button, edit, close };
}

describe("visible task-first CMO workbench", () => {
  it("derives the active step from the actual receipt and confirmed queue, including hydration", async () => {
    const ui = await mount();
    const current = () =>
      ui.container.querySelector(
        '[aria-label="Trial preparation flow"] [aria-current="step"]'
      )?.textContent;
    try {
      expect(current()).toContain("Your Brief");
      const receipt = research();
      await act(async () =>
        ui.root.render(
          createElement(OpportunityWorkbench, { ...ui.props, research: receipt })
        )
      );
      expect(current()).toContain("Review a trial kit");
      const confirmed: PlannedExperiment = {
        id: "trial-1",
        templateId: "product-trial",
        sourceExperimentId: "",
        platformId: "twitter",
        platformName: "X / Twitter",
        venue: "Own profile",
        angle: receipt.input.task,
        variable: "exploratory",
        heldConstant: "Untested",
        status: "ready",
        postIdx: 0,
        createdAt: receipt.completedAt,
      };
      await act(async () =>
        ui.root.render(
          createElement(OpportunityWorkbench, {
            ...ui.props,
            research: receipt,
            queue: [confirmed],
          })
        )
      );
      expect(current()).toContain("Put it into Today");
      expect(current()).toContain("Confirmed in your workspace");
      await ui.edit("2. One useful task to try", "A different unsubmitted task");
      expect(current()).toContain("Your Brief");
      expect(
        ui.container.querySelectorAll(
          '[aria-label="Trial preparation flow"] [aria-current="step"]'
        )
      ).toHaveLength(1);
    } finally {
      await ui.close();
    }
  });
  it("replaces only an untouched X venue default when changing channel", async () => {
    const ui = await mount();
    try {
      const channel = ui.container.querySelector<HTMLSelectElement>(
        '[aria-label="Trial publishing channel"]'
      )!;
      await act(async () => {
        channel.value = "linkedin";
        channel.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(async () => ui.button("Preview fictional trial kit").click());
      expect(ui.props.onResearch).toHaveBeenLastCalledWith(
        expect.objectContaining({ platformId: "linkedin", venue: "Own profile" }),
        false
      );
      await ui.edit("Publishing venue — not an evidence source", "My chosen community");
      await act(async () => {
        channel.value = "twitter";
        channel.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(async () => ui.button("Preview fictional trial kit").click());
      expect(ui.props.onResearch).toHaveBeenLastCalledWith(
        expect.objectContaining({ platformId: "twitter", venue: "My chosen community" }),
        false
      );
    } finally {
      await ui.close();
    }
  });
  it("preserves an explicitly edited or saved venue even when its text matches the old default", async () => {
    const ui = await mount({ research: research() });
    try {
      const channel = ui.container.querySelector<HTMLSelectElement>(
        '[aria-label="Trial publishing channel"]'
      )!;
      await act(async () => {
        channel.value = "linkedin";
        channel.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(async () => ui.button("Preview fictional trial kit").click());
      expect(ui.props.onResearch).toHaveBeenLastCalledWith(
        expect.objectContaining({ platformId: "linkedin", venue: "Own X profile" }),
        false
      );
    } finally {
      await ui.close();
    }
  });
  it("opens the three-field Brief with delivery details collapsed", async () => {
    const ui = await mount();
    try {
      expect(ui.container.textContent).toContain("Prepare one useful product trial");
      expect(ui.container.textContent).toContain(contract.primaryGoal);
      expect(ui.container.textContent).toContain("no external demand evidence");
      expect(ui.container.querySelector("details")?.open).toBe(false);
      expect(ui.button("Preview fictional trial kit").disabled).toBe(false);
    } finally {
      await ui.close();
    }
  });
  it("passes demo edits as a source-free Brief without a fake live task", async () => {
    const ui = await mount();
    try {
      await ui.edit("2. One useful task to try", "Inspect a sample job timeline");
      await act(async () => ui.button("Preview fictional trial kit").click());
      expect(ui.props.onResearch).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "product-led",
          sources: [],
          task: "Inspect a sample job timeline",
        }),
        false
      );
      expect(ui.container.textContent).toContain("never saved");
    } finally {
      await ui.close();
    }
  });
  it("keeps real execution disabled while the Brief remains editable", async () => {
    const ui = await mount({ demo: false });
    try {
      await ui.edit("2. One useful task to try", "My task while execution is off");
      expect(ui.button("Prepare my trial kit").disabled).toBe(true);
      expect(ui.container.textContent).toContain("not enabled");
      expect(ui.container.querySelector('a[href="/app?demo=1"]')).not.toBeNull();
      expect(ui.props.onResearch).not.toHaveBeenCalled();
    } finally {
      await ui.close();
    }
  });
  it("reviews a product-led kit without a source and requires both confirmations", async () => {
    const ui = await mount({ research: research() });
    try {
      await act(async () => ui.button("Review this trial kit").click());
      expect(ui.container.textContent).toContain("Invitation draft");
      expect(ui.container.textContent).toContain("not generated attachments");
      expect(ui.button("Confirm trial into Today").disabled).toBe(true);
      const boxes = [
        ...ui.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
      ];
      await act(async () => boxes[0].click());
      expect(ui.button("Confirm trial into Today").disabled).toBe(true);
      await act(async () => boxes[1].click());
      expect(ui.button("Confirm trial into Today").disabled).toBe(false);
      await act(async () => ui.button("Confirm trial into Today").click());
      expect(ui.props.onQueue).toHaveBeenCalledWith(
        "brief-research",
        "trial-1",
        true,
        true
      );
    } finally {
      await ui.close();
    }
  });
  it("invalidates the selected kit after demo edits instead of reusing approval", async () => {
    const ui = await mount({ research: research() });
    try {
      await act(async () => ui.button("Review this trial kit").click());
      for (const box of ui.container.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]'
      ))
        await act(async () => box.click());
      await ui.edit("3. One question you want answered", "What did you expect instead?");
      expect(ui.container.textContent).toContain("Brief edits have not been applied");
      expect(ui.container.textContent).not.toContain("Your review · trial kit");
      expect(ui.button("Review this trial kit").disabled).toBe(true);
      expect(ui.props.onQueue).not.toHaveBeenCalled();
    } finally {
      await ui.close();
    }
  });
  it("never silently overwrites a hand-edited Brief on profile rerender", async () => {
    const ui = await mount();
    try {
      await ui.edit("2. One useful task to try", "My handwritten task");
      await act(async () =>
        ui.root.render(
          createElement(OpportunityWorkbench, {
            ...ui.props,
            profile: { ...ui.props.profile, name: "Changed profile" },
          })
        )
      );
      expect(
        [...ui.container.querySelectorAll("input")].some(
          (input) => input.value === "My handwritten task"
        )
      ).toBe(true);
    } finally {
      await ui.close();
    }
  });
  it("requires an explicit source after switching to evidence mode", async () => {
    const ui = await mount();
    try {
      const radios = ui.container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
      await act(async () => radios[1].click());
      expect(ui.container.textContent).toContain("Demand source 1 URL");
      expect(ui.button("Preview fictional trial kit").disabled).toBe(true);
      await act(async () => radios[0].click());
      expect(ui.container.textContent).not.toContain("Demand source 1 URL");
      expect(ui.button("Preview fictional trial kit").disabled).toBe(false);
    } finally {
      await ui.close();
    }
  });
  it("revokes DeepSeek acknowledgement whenever the public Brief changes", async () => {
    const props = baseProps();
    const ui = await mount({
      demo: false,
      provider: "deepseek",
      agent: { ...props.agent, enabled: true },
    });
    try {
      expect(ui.button("Prepare my trial kit").disabled).toBe(true);
      const consent = ui.container.querySelector<HTMLInputElement>(
        'input[type="checkbox"]'
      );
      if (!consent) throw new Error("Missing DeepSeek acknowledgement");
      await act(async () => consent.click());
      expect(ui.button("Prepare my trial kit").disabled).toBe(false);
      await ui.edit("2. One useful task to try", "Changed public test instructions");
      expect(consent.checked).toBe(false);
      expect(ui.button("Prepare my trial kit").disabled).toBe(true);
    } finally {
      await ui.close();
    }
  });
  it("revokes DeepSeek acknowledgement when reviewing a saved task with different inputs", async () => {
    const props = baseProps();
    const receipt = research();
    const ui = await mount({
      demo: false,
      provider: "deepseek",
      agent: {
        ...props.agent,
        enabled: true,
        runs: [
          {
            id: "saved-run",
            projectId: "project",
            status: "ready",
            phase: "ready",
            provider: "deepseek",
            createdAt: receipt.completedAt,
            updatedAt: receipt.completedAt,
            interrupted: false,
            canResume: false,
            modelAttempted: true,
            sourceCount: 0,
            checkedSources: 0,
            input: { ...receipt.input, task: "Another saved task" },
            research: receipt,
          },
        ],
      },
    });
    try {
      const consent = ui.container.querySelector<HTMLInputElement>(
        'input[type="checkbox"]'
      )!;
      await act(async () => consent.click());
      expect(ui.button("Prepare my trial kit").disabled).toBe(false);
      await act(async () => ui.button("Review draft proposals").click());
      expect(consent.checked).toBe(false);
      expect(ui.button("Prepare my trial kit").disabled).toBe(true);
      expect(ui.props.onReviewAgent).toHaveBeenCalledWith("saved-run");
      expect(
        [...ui.container.querySelectorAll("input")].some(
          (input) => input.value === "Another saved task"
        )
      ).toBe(true);
    } finally {
      await ui.close();
    }
  });
});
