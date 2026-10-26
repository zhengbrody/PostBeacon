// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyResearchMission } from "@/components/app/results/DailyResearchMission";
import { DEMO_PROJECT } from "@/lib/demo";
import { researchContextKey } from "@/lib/opportunityResearch";
import { defaultSuccessContract } from "@/lib/successContract";
import { createTrialBrief } from "@/lib/trialBrief";
import type { AgentMission } from "@/lib/agentMissions";

const calls = vi.hoisted(() => ({ agentMission: vi.fn(), agentMissionCommand: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: calls }));
const contract = defaultSuccessContract("User feedback / conversations");
const props = (): ComponentProps<typeof DailyResearchMission> => ({
  ownerId: "owner-A",
  projectId: "dcf5ebba-079b-4e26-8543-82daabedcf36",
  demo: true,
  profile: DEMO_PROJECT.profile,
  facts: DEMO_PROJECT.facts,
  contract,
  productUrl: DEMO_PROJECT.url,
  bannedClaims: [],
  onRunsChanged: vi.fn(),
});
function mission(patch: Partial<AgentMission> = {}): AgentMission {
  const input = props();
  return {
    id: "fcf5ebba-079b-4e26-8543-82daabedcf36",
    projectId: input.projectId,
    revision: 2,
    enabled: true,
    contextKey: researchContextKey(
      input.profile,
      input.facts,
      contract,
      input.productUrl,
      []
    ),
    settings: {
      enabled: true,
      brief: createTrialBrief(input.profile, input.productUrl),
      searchQueries: ["background job failures"],
      allowedDomains: ["example.org"],
    },
    createdAt: "2026-10-25T12:00:00Z",
    updatedAt: "2026-10-25T12:00:00Z",
    expiresAt: "2099-11-24T12:00:00Z",
    ...patch,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  calls.agentMission.mockResolvedValue({ enabled: false, mission: null });
});
afterEach(() => vi.unstubAllGlobals());

async function mount(patch: Partial<ComponentProps<typeof DailyResearchMission>> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const input = { ...props(), ...patch };
  await act(async () => root.render(createElement(DailyResearchMission, input)));
  const button = (label: string) => {
    const result = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes(label)
    );
    if (!result) throw new Error(`Missing button ${label}`);
    return result;
  };
  const edit = async (partial: string, value: string) => {
    const label = [...container.querySelectorAll("label")].find((item) =>
      item.textContent?.startsWith(partial)
    );
    const node =
      label &&
      [
        ...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input,textarea"
        ),
      ].find((item) => item.id === label.htmlFor);
    if (!node) throw new Error(`Missing field ${partial}`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        node instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value"
      )!.set!.call(node, value);
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const approve = async () =>
    act(async () => {
      for (const checkbox of container.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]'
      ))
        if (!checkbox.checked) checkbox.click();
    });
  const setup = async () => {
    await edit("Daily research public search queries", "background job failure alerts");
    await edit("Daily research allowed domains", "example.org");
    await approve();
  };
  return {
    input,
    container,
    button,
    edit,
    approve,
    setup,
    render: async (next: Partial<ComponentProps<typeof DailyResearchMission>>) =>
      act(async () =>
        root.render(createElement(DailyResearchMission, { ...input, ...next }))
      ),
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("daily research delegation UI", () => {
  it("requires explicit approvals, previews authorization/pause with no network or storage", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const ui = await mount();
    try {
      expect(ui.container.textContent).toContain(
        "Example only: no scheduler, search or model calls"
      );
      expect(ui.button("Preview daily authorization").disabled).toBe(true);
      await ui.setup();
      expect(ui.button("Preview daily authorization").disabled).toBe(false);
      await act(async () => ui.button("Preview daily authorization").click());
      expect(ui.container.textContent).toContain("Saved delegation · revision 1");
      expect(ui.container.querySelector('[role="status"]')?.textContent).toContain(
        "No scheduler, search or model was started"
      );
      await act(async () => ui.button("Preview a check").click());
      expect(ui.container.querySelector('[role="status"]')?.textContent).toContain(
        "No search, model or scheduler call occurred"
      );
      await act(async () => ui.button("Pause daily research").click());
      expect(ui.container.querySelector('[role="status"]')?.textContent).toContain(
        "Example paused"
      );
      expect(calls.agentMission).not.toHaveBeenCalled();
      expect(calls.agentMissionCommand).not.toHaveBeenCalled();
      expect(storage).not.toHaveBeenCalled();
    } finally {
      storage.mockRestore();
      await ui.close();
    }
  });
  it("clears both approvals for every edited input and changed fact context", async () => {
    const ui = await mount();
    try {
      await ui.setup();
      await ui.edit("Daily research feedback question", "Which task was unclear?");
      expect(
        [
          ...ui.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
        ].every((node) => !node.checked)
      ).toBe(true);
      await ui.approve();
      const facts = ui.input.facts.map((fact, index) =>
        index === 0 ? { ...fact, claim: `${fact.claim} changed` } : fact
      );
      await ui.render({ facts });
      expect(
        [
          ...ui.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
        ].every((node) => !node.checked)
      ).toBe(true);
      expect(ui.button("Preview daily authorization").disabled).toBe(true);
    } finally {
      await ui.close();
    }
  });
  it("keeps a flag-closed deployment editable without allowing save or execution", async () => {
    const ui = await mount({ demo: false });
    try {
      await ui.setup();
      expect(ui.container.textContent).toContain("Execution not enabled");
      expect(ui.button("Save & authorize").disabled).toBe(true);
      expect(ui.container.textContent).not.toContain("Daily authorization on");
      expect(calls.agentMissionCommand).not.toHaveBeenCalled();
    } finally {
      await ui.close();
    }
  });
  it("lets an owner pause a saved authorization while global execution is disabled", async () => {
    const saved = mission();
    calls.agentMission.mockResolvedValue({ enabled: false, mission: saved });
    calls.agentMissionCommand.mockResolvedValue({
      enabled: false,
      mission: {
        ...saved,
        enabled: false,
        settings: { ...saved.settings, enabled: false },
      },
    });
    const ui = await mount({ demo: false });
    try {
      expect(ui.button("Check now").disabled).toBe(true);
      expect(ui.button("Pause daily research").disabled).toBe(false);
      await act(async () => ui.button("Pause daily research").click());
      expect(ui.container.querySelector('[role="status"]')?.textContent).toContain(
        "Daily authorization paused"
      );
      expect(calls.agentMissionCommand.mock.calls[0][0]).toEqual({
        action: "pause",
        projectId: saved.projectId,
      });
    } finally {
      await ui.close();
    }
  });
  it("does not represent quote matching as verified demand or permission", async () => {
    calls.agentMission.mockResolvedValue({ enabled: true, mission: mission() });
    const ui = await mount({ demo: false });
    try {
      expect(ui.container.textContent).toContain(
        "not verified demand or permission to post"
      );
      expect(ui.container.textContent).toContain("Empty results remain empty");
      expect(ui.container.textContent).toContain("No DeepSeek fallback");
      expect(ui.container.textContent).toContain("No automatic renewal");
    } finally {
      await ui.close();
    }
  });
  it.each([{ contextKey: "old-context" }, { expiresAt: "2020-01-01T00:00:00Z" }])(
    "blocks stale or expired authorizations rather than renewing silently (%j)",
    async (patch) => {
      calls.agentMission.mockResolvedValue({ enabled: true, mission: mission(patch) });
      const ui = await mount({ demo: false });
      try {
        expect(ui.container.textContent).toContain("Re-approval needed");
        expect(ui.button("Check now").disabled).toBe(true);
        expect(calls.agentMissionCommand).not.toHaveBeenCalled();
      } finally {
        await ui.close();
      }
    }
  );
  it("does not show success after an authorization error", async () => {
    calls.agentMission.mockResolvedValue({ enabled: true, mission: null });
    calls.agentMissionCommand.mockRejectedValue(new Error("Revision conflict"));
    const ui = await mount({ demo: false });
    try {
      await ui.setup();
      await act(async () => ui.button("Save & authorize").click());
      expect(ui.container.querySelector('[role="alert"]')?.textContent).toBe(
        "Revision conflict"
      );
      expect(ui.container.querySelector('[role="status"]')).toBeNull();
      expect(ui.container.textContent).not.toContain("Saved delegation · revision");
    } finally {
      await ui.close();
    }
  });
  it("saves only explicitly approved settings with the server revision and current context", async () => {
    const saved = mission();
    calls.agentMission.mockResolvedValue({ enabled: true, mission: saved });
    calls.agentMissionCommand.mockResolvedValue({
      enabled: true,
      mission: { ...saved, revision: 3 },
    });
    const ui = await mount({
      demo: false,
      initialBrief: {
        ...saved.settings.brief,
        mode: "evidence-led",
        sources: [
          {
            url: "https://example.org/source",
            quote: "Unapproved external excerpt",
            fetchAllowed: false,
          },
        ],
      },
    });
    try {
      await ui.setup();
      await act(async () => ui.button("Save & authorize").click());
      expect(calls.agentMissionCommand.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          action: "save",
          projectId: saved.projectId,
          expectedRevision: 2,
          contextKey: saved.contextKey,
          consent: { publicSearch: true, openaiProcessing: true },
          settings: expect.objectContaining({
            brief: expect.objectContaining({ mode: "product-led", sources: [] }),
          }),
        })
      );
      expect(ui.container.querySelector('[role="status"]')?.textContent).toContain(
        "revision 3"
      );
      expect(
        [
          ...ui.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
        ].every((node) => !node.checked)
      ).toBe(true);
    } finally {
      await ui.close();
    }
  });
  it("requests a check only explicitly and refreshes actual mission and task receipts", async () => {
    const saved = mission();
    calls.agentMission.mockResolvedValue({ enabled: true, mission: saved });
    calls.agentMissionCommand.mockResolvedValue({
      enabled: true,
      mission: saved,
      run: { id: "real-task-receipt" },
    });
    const ui = await mount({ demo: false });
    try {
      expect(calls.agentMissionCommand).not.toHaveBeenCalled();
      await act(async () => ui.button("Check now").click());
      expect(calls.agentMissionCommand.mock.calls[0][0]).toEqual({
        action: "run-now",
        projectId: saved.projectId,
        contextKey: saved.contextKey,
        expectedRevision: saved.revision,
      });
      expect(ui.input.onRunsChanged).toHaveBeenCalledTimes(1);
      expect(calls.agentMission).toHaveBeenCalledTimes(2);
      expect(ui.container.querySelector('[role="status"]')?.textContent).toContain(
        "actual task receipt"
      );
      expect(ui.container.querySelector('[role="status"]')?.textContent).not.toContain(
        "opportunity found"
      );
    } finally {
      await ui.close();
    }
  });
  it("does not carry an account's edited queries or approvals into the next account", async () => {
    const ui = await mount();
    try {
      await ui.setup();
      await ui.render({ ownerId: "owner-B" });
      const values = [
        ...ui.container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input,textarea"
        ),
      ].map((node) => node.value);
      expect(values).not.toContain("background job failure alerts");
      expect(
        [
          ...ui.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
        ].every((node) => !node.checked)
      ).toBe(true);
    } finally {
      await ui.close();
    }
  });
  it("rejects email/secret queries and disallowed social domains before authorization", async () => {
    const ui = await mount();
    try {
      await ui.setup();
      await ui.edit("Daily research public search queries", "find person@example.org");
      await ui.approve();
      expect(ui.button("Preview daily authorization").disabled).toBe(true);
      await ui.edit("Daily research public search queries", "public background job tools");
      await ui.edit("Daily research allowed domains", "reddit.com");
      await ui.approve();
      expect(ui.button("Preview daily authorization").disabled).toBe(true);
      expect(calls.agentMissionCommand).not.toHaveBeenCalled();
    } finally {
      await ui.close();
    }
  });
});
