// @vitest-environment jsdom
import { act, createElement, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutreachCard } from "@/components/app/results/OutreachCard";
import { flowReducer, initialFlowState, type FlowState } from "@/hooks/launchFlowReducer";
import { useOutreach } from "@/hooks/useOutreach";
import { api } from "@/lib/api";
import { DEMO_PROJECT } from "@/lib/demo";
import type { OutreachContact } from "@/lib/types";

vi.mock("@/lib/api", () => ({ api: { outreach: vi.fn() } }));
const outreachApi = vi.mocked(api.outreach);

let container: HTMLDivElement;
let root: Root;
let latest: FlowState;
const clipboard = { writeText: vi.fn(async (_text: string) => undefined) };

function Harness({ base, owner }: { base: FlowState; owner: string | null }) {
  const [state, dispatch] = useReducer(flowReducer, base);
  latest = state;
  return createElement(OutreachCard, {
    controller: useOutreach(state, dispatch, owner, true),
  });
}
const project = (demo: boolean, outreach?: OutreachContact[]) =>
  flowReducer(initialFlowState, {
    type: "PROJECT_LOADED",
    project: {
      ...DEMO_PROJECT,
      id: "project-a",
      ...(outreach ? { workspace: { experiments: [], taskLog: [], outreach } } : {}),
    },
    demo,
  });
async function mount(base: FlowState, owner: string | null = null) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness, { base, owner })));
}
const text = () => container.textContent ?? "";
const button = (label: string) => {
  const found = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(label)
  );
  if (!found) throw new Error(`No button "${label}" in: ${text().slice(0, 500)}`);
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
async function addPerson() {
  await type("Who (your own label)", "Founder in a forum thread");
  await type("Public link", "https://forum.example/thread/1");
  await type("What they said they need", "Cannot tell which channel to try first");
  await click("Add to list");
}
const contacts = () => latest.workspace.outreach ?? [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("outreach card", () => {
  it("lets a signed-out founder write, copy, record as sent and record a reply with no model call", async () => {
    await mount(project(false));
    expect(text()).toContain("PostBeacon sends nothing and looks nobody up");
    await addPerson();
    expect(contacts()).toHaveLength(1);
    expect(button("Draft 1 message").disabled).toBe(true);
    expect(text()).toContain("write each message yourself");

    await type(
      "Your message",
      "You said picking a channel is hard. I built a tool. Try it?"
    );
    await click("Save message");
    expect(contacts()[0]).toMatchObject({ status: "drafted", messageSource: "founder" });

    await click("Copy message");
    expect(clipboard.writeText).toHaveBeenCalledWith(contacts()[0].message);
    expect(text()).toContain("Copied. Nothing was sent.");

    // Recording as sent needs the founder's own confirmation.
    expect(button("Record as sent").disabled).toBe(true);
    await act(async () =>
      (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click()
    );
    await click("Record as sent");
    expect(contacts()[0].status).toBe("sent");
    expect(container.querySelector("textarea#outreach-" + contacts()[0].id)).toBeNull();

    await type("What did they reply?", "They tried it and asked about pricing");
    await click("Record reply");
    expect(contacts()[0]).toMatchObject({ status: "replied" });
    expect(text()).toContain("What came back (your note)");
    expect(outreachApi).not.toHaveBeenCalled();
  });

  it("drafts the batch with one request that carries the need but not who or where", async () => {
    outreachApi.mockResolvedValue({
      drafts: [
        { alias: "c1", message: "You said channels are hard. I built this.", factIds: [] },
      ],
      meta: { provider: "openai", model: "m" },
    });
    await mount(project(false), "owner-1");
    await addPerson();
    await click("Draft 1 message");
    expect(outreachApi).toHaveBeenCalledTimes(1);
    const [body, owner] = outreachApi.mock.calls[0];
    expect(owner).toBe("owner-1");
    expect(body.people).toEqual([
      { alias: "c1", need: "Cannot tell which channel to try first" },
    ]);
    expect(JSON.stringify(body.people)).not.toContain("forum.example");
    expect(contacts()[0]).toMatchObject({ status: "drafted", messageSource: "agent" });
    expect(text()).toContain("drafted by the agent, edit freely");
  });

  it("shows why a message cannot be sent and offers no copy or sent button", async () => {
    await mount(project(false));
    await addPerson();
    await type("Your message", "In one experiment, activity picked up in just 72 hours.");
    await click("Save message");
    expect(text()).toContain("Fix before sending");
    expect(() => button("Copy message")).toThrow();
    expect(() => button("Record as sent")).toThrow();
  });

  it("keeps the list unchanged and says so when drafting fails", async () => {
    outreachApi.mockRejectedValue(new Error("Daily limit reached."));
    await mount(project(false), "owner-1");
    await addPerson();
    await click("Draft 1 message");
    expect(text()).toContain("Daily limit reached.");
    expect(contacts()[0].status).toBe("new");
  });

  it("does not apply a draft that arrives after the founder wrote their own message", async () => {
    let release: (value: Awaited<ReturnType<typeof api.outreach>>) => void = () => {};
    outreachApi.mockReturnValue(new Promise((resolve) => (release = resolve)));
    await mount(project(false), "owner-1");
    await addPerson();
    await click("Draft 1 message");
    expect(text()).toContain("Drafting…");
    await type("Your message", "My own words for this person, thanks.");
    await click("Save message");
    await act(async () =>
      release({
        drafts: [{ alias: "c1", message: "Agent text", factIds: [] }],
        meta: { provider: "openai", model: "m" } as never,
      })
    );
    expect(contacts()[0].message).toBe("My own words for this person, thanks.");
    expect(text()).toContain("0 of 1 drafted");
  });

  it("uses a coded fictional message in the demo and never calls the route", async () => {
    await mount(project(true), "owner-1");
    await addPerson();
    expect(contacts()[0].example).toBe(true);
    await click("Draft 1 message");
    expect(contacts()[0].message).toContain("Fictional example");
    expect(outreachApi).not.toHaveBeenCalled();
    expect(text()).toContain("Fictional");
  });

  it("drops fictional contacts when a real project loads, and unsent drafts on re-analysis", () => {
    const at = "2026-11-28T10:00:00.000Z";
    const contact = (id: string, extra: Partial<OutreachContact>): OutreachContact => ({
      id,
      revision: 0,
      label: "Someone",
      need: "Needs a clearer first step",
      origin: "founder",
      status: "new",
      createdAt: at,
      updatedAt: at,
      ...extra,
    });
    const loaded = project(false, [
      contact("demo", { example: true }),
      contact("draft", {}),
      contact("sent", { status: "sent", message: "hello there", sentAt: at }),
    ]);
    expect(loaded.workspace.outreach?.map((c) => c.id)).toEqual(["draft", "sent"]);
    const again = flowReducer(loaded, {
      type: "ANALYZED",
      profile: DEMO_PROJECT.profile!,
      facts: DEMO_PROJECT.facts,
      questions: [],
    });
    expect(again.workspace.outreach?.map((c) => c.id)).toEqual(["sent"]);
  });
});
