// @vitest-environment jsdom
import { act, createElement, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeeklyTaskCard } from "@/components/app/results/WeeklyTaskCard";
import { flowReducer, initialFlowState, type FlowState } from "@/hooks/launchFlowReducer";
import { useWeeklyTask } from "@/hooks/useWeeklyTask";
import { DEMO_PROJECT } from "@/lib/demo";
import { DRAFT_SCHEMA_VERSION, migrateDraft } from "@/lib/storage";

vi.mock("@/lib/api", () => ({ api: { weeklyTask: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;
let latest: FlowState;
const clipboard = { writeText: vi.fn(async (_text: string) => undefined) };

function Harness({ base, demo }: { base: FlowState; demo: boolean }) {
  const [state, dispatch] = useReducer(flowReducer, base);
  latest = state;
  const controller = useWeeklyTask(state, dispatch, null, false);
  return createElement(WeeklyTaskCard, {
    key: controller.task?.id ?? "none",
    controller,
    workspace: state.workspace,
    facts: state.facts,
    productName: state.profile?.name ?? "",
    productUrl: state.url,
    demo,
  });
}
const project = (demo: boolean, workspace?: FlowState["workspace"]) =>
  flowReducer(initialFlowState, {
    type: "PROJECT_LOADED",
    project: {
      ...DEMO_PROJECT,
      id: "project-a",
      ...(workspace ? { workspace } : {}),
    },
    demo,
  });
async function mount(base: FlowState, demo = false) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness, { base, demo })));
}
const text = () => container.textContent ?? "";
const button = (label: string) => {
  const found = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(label)
  );
  if (!found) throw new Error(`No button "${label}" in: ${text().slice(0, 400)}`);
  return found;
};
const click = (label: string) => act(async () => button(label).click());
async function type(label: string, value: string) {
  const labelEl = Array.from(container.querySelectorAll("label")).find((l) =>
    l.textContent?.includes(label)
  );
  if (!labelEl) throw new Error(`No field "${label}"`);
  const field = document.getElementById(labelEl.htmlFor) as
    HTMLInputElement | HTMLTextAreaElement;
  const proto =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const choose = (scenario: number, result: string) =>
  act(async () => {
    const group = container.querySelectorAll(`input[name="weekly-scenario-${scenario}"]`);
    const radio = Array.from(group).find((input) =>
      input.parentElement?.textContent?.includes(result)
    ) as HTMLInputElement;
    radio.click();
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clipboard.writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("weekly task card: the whole path", () => {
  it("confirms a task, copies the brief, survives a reload and verifies only with evidence", async () => {
    await mount(project(false));
    expect(text()).toContain("Pick one thing worth doing this week");
    // The growth goal is reused; only the pain must be typed.
    await type("Which user pain", "New visitors do not know what to do first");
    await type("Hours you can really spend", "4");
    await click("Save inputs");
    expect(latest.workspace.weeklyTask?.status).toBe("planning");
    expect(text()).toContain("Agent proposals need a signed-in account");
    expect(button("Ask the Agent for one proposal").disabled).toBe(true);

    await click("Write it myself");
    await type("Task title", "Add a sample project to the empty state");
    await type("Why this task", "The first screen is empty for new visitors.");
    await type("Smallest scope", "Show one read-only sample on first visit");
    await type(
      "Acceptance scenarios",
      "A visitor sees the sample\nThe sample can be dismissed"
    );
    await click("Save task for review");
    expect(latest.workspace.weeklyTask?.status).toBe("proposed");
    expect(text()).toContain("Written by you.");
    expect(text()).toContain("No verified product fact is cited");

    await click("Confirm this task");
    expect(latest.workspace.weeklyTask?.status).toBe("building");
    await click("Copy Build Brief");
    const brief = clipboard.writeText.mock.calls[0][0];
    expect(brief).toContain("# Build Brief — Add a sample project to the empty state");
    expect(brief).toContain("## Acceptance scenarios");
    expect(brief).toContain("PostBeacon has NOT read the repository");
    expect(text()).toContain("Copied.");

    // "Refresh": serialize what autosave stores, load it back, mount a fresh tree.
    const saved = migrateDraft(
      JSON.parse(
        JSON.stringify({ schemaVersion: DRAFT_SCHEMA_VERSION, workspace: latest.workspace })
      )
    )!;
    await act(async () => root.unmount());
    container.remove();
    await mount(project(false, saved.workspace));
    expect(text()).toContain("In development");
    expect(text()).toContain("Add a sample project to the empty state");

    await type("Add a progress note", "Sample is rendering locally");
    await click("Save note");
    expect(text()).toContain("Sample is rendering locally");
    await click("Development done — verify it");
    expect(latest.workspace.weeklyTask?.status).toBe("verifying");

    // No evidence → not verified, and the card says why.
    await click("Submit evidence");
    expect(latest.workspace.weeklyTask?.status).toBe("verifying");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Describe what actually changed"
    );
    await type(
      "What changed",
      "Shipped a read-only sample on the first screen on Tuesday."
    );
    await type("What you observed", "Opened the live site signed out; the sample loaded.");
    await choose(0, "Passed");
    await click("Submit evidence"); // second scenario still unchecked
    expect(latest.workspace.weeklyTask?.status).toBe("verifying");
    await choose(1, "Passed");
    await click("Submit evidence");
    expect(latest.workspace.weeklyTask?.status).toBe("verified");
    expect(text()).toContain("PostBeacon did not inspect your product or repository");

    await click("Close and plan next week");
    expect(latest.workspace.weeklyTask).toBeUndefined();
    expect(text()).toContain("Earlier tasks (1)");
  });

  it("does not claim a copy the browser refused", async () => {
    clipboard.writeText.mockRejectedValueOnce(new Error("denied"));
    const base = project(false);
    await mount(base);
    await type("Which user pain", "New visitors do not know what to do first");
    await type("Hours you can really spend", "2");
    await click("Save inputs");
    await click("Write it myself");
    await type("Task title", "Interview five users");
    await type("Why this task", "There is no evidence about the pain yet.");
    await type("Smallest scope", "Five short calls");
    await type("Acceptance scenarios", "Five calls have notes");
    await click("Save task for review");
    await click("Confirm this task");
    await click("Copy Build Brief");
    expect(text()).not.toContain("Copied.");
    expect(text()).toContain("select the text below and copy it manually");
  });

  it("labels the demo as fictional and reaches a proposal without any API call", async () => {
    const { api } = await import("@/lib/api");
    await mount(project(true), true);
    expect(text()).toContain("Fictional example · no model call · not saved");
    await type("Which user pain", "New visitors do not know what to do first");
    await type("Hours you can really spend", "3");
    await click("Save inputs");
    await click("Show a fictional proposal");
    expect(latest.workspace.weeklyTask?.proposalSource).toBe("example");
    expect(text()).toContain("Fictional example written by code — no model call.");
    expect(text()).toContain("Unknown — not established by evidence");
    expect(api.weeklyTask).not.toHaveBeenCalled();
  });

  it("requires a second click to abandon", async () => {
    await mount(project(false));
    await type("Which user pain", "New visitors do not know what to do first");
    await type("Hours you can really spend", "2");
    await click("Save inputs");
    await click("Abandon task");
    expect(latest.workspace.weeklyTask).toBeDefined();
    await click("Confirm: abandon this task");
    expect(latest.workspace.weeklyTask).toBeUndefined();
  });
});
