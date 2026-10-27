// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  BufferPublishingCard,
  scheduleUtc,
} from "@/components/app/results/BufferPublishingCard";
import { DEMO_PROJECT } from "@/lib/demo";
import { defaultSuccessContract } from "@/lib/successContract";
const remote = vi.hoisted(() => ({
  enabled: false,
  checking: false,
  busy: false,
  connection: null,
  deliveries: [],
  setupIssues: [],
  error: "",
  refresh: vi.fn(),
  connectionCommand: vi.fn(),
  deliveryCommand: vi.fn(),
}));
vi.mock("@/hooks/useBufferPublishing", () => ({ useBufferPublishing: () => remote }));
const props: ComponentProps<typeof BufferPublishingCard> = {
  ownerId: null,
  projectId: "demo",
  demo: true,
  profile: DEMO_PROJECT.profile,
  facts: DEMO_PROJECT.facts,
  contract: defaultSuccessContract("feedback"),
  plans: [],
  bannedClaims: [],
  productUrl: "https://cronwise.dev/",
  result: {
    ...DEMO_PROJECT.result,
    content: [
      {
        ...DEMO_PROJECT.result.content[0],
        platformId: "twitter",
        platformName: "X",
        posts: [
          {
            hook: "Cronwise",
            body: "Try the demo: https://cronwise.dev/",
            imageSuggestion: "",
            bestTime: "",
            caveats: "",
          },
        ],
      },
    ],
  },
};
async function mount(input = props) {
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => {
    root.render(createElement(BufferPublishingCard, input));
  });
  return {
    node,
    async render(next: typeof props) {
      await act(async () => {
        root.render(createElement(BufferPublishingCard, next));
      });
    },
    async close() {
      await act(async () => root.unmount());
      node.remove();
    },
  };
}
async function click(node: HTMLElement, label: string) {
  const button = Array.from(node.querySelectorAll("button")).find(
    (b) => b.textContent === label
  );
  expect(button, `missing ${label}`).toBeTruthy();
  await act(async () => button!.click());
  return button!;
}
async function setTime(node: HTMLElement, value: string) {
  const input = node.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      value
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Buffer exact approval interaction", () => {
  it("the real fictional demo contains a single-post candidate that passes the same deterministic gates", async () => {
    const view = await mount({ ...props, result: DEMO_PROJECT.result });
    try {
      expect(view.node.querySelector<HTMLSelectElement>("select")!.value).toBe("twitter:1");
      await setTime(view.node, new Date(Date.now() + 3_600_000).toISOString().slice(0, 16));
      expect((await click(view.node, "Preview example approval")).disabled).toBe(false);
      expect(view.node.textContent).toContain("How do you notice");
    } finally {
      await view.close();
    }
  });
  it("an already prepared approval remains usable inside its expiry even when fewer than ten minutes remain", async () => {
    const started = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(started);
    const view = await mount();
    try {
      await setTime(view.node, new Date(started + 12 * 60_000).toISOString().slice(0, 16));
      await click(view.node, "Preview example approval");
      now.mockReturnValue(started + 5 * 60_000);
      await act(async () =>
        view.node.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
      );
      expect(
        Array.from(view.node.querySelectorAll("button")).find(
          (b) => b.textContent === "Preview example approval"
        )!.disabled
      ).toBe(true);
      expect(
        Array.from(view.node.querySelectorAll("button")).find(
          (b) => b.textContent === "Simulate approved scheduling — no send"
        )!.disabled
      ).toBe(false);
    } finally {
      await view.close();
    }
  });
  it("strictly interprets the displayed schedule as UTC and rejects rolled calendar dates", () => {
    expect(scheduleUtc("2026-11-01T01:30")).toBe("2026-11-01T01:30:00.000Z");
    expect(scheduleUtc("2026-02-30T12:00")).toBeUndefined();
    expect(scheduleUtc("2026-11-01T01:30-08:00")).toBeUndefined();
  });
  it("demo shows complete frozen text, requires explicit consent, and reports scheduled not published without any API", async () => {
    const view = await mount();
    try {
      await setTime(view.node, new Date(Date.now() + 3_600_000).toISOString().slice(0, 16));
      const prepare = await click(view.node, "Preview example approval");
      expect(prepare.disabled).toBe(false);
      expect(
        view.node.querySelector('section[aria-label="Frozen publishing approval"]')
          ?.textContent
      ).toContain("Try the demo");
      const button = Array.from(view.node.querySelectorAll("button")).find(
        (b) => b.textContent === "Simulate approved scheduling — no send"
      )!;
      expect(button.disabled).toBe(true);
      await act(async () =>
        view.node.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
      );
      expect(button.disabled).toBe(false);
      await click(view.node, "Simulate approved scheduling — no send");
      expect(view.node.textContent).toContain("Scheduled in Buffer — not published");
      expect(view.node.textContent).toContain("Nothing was sent, saved or published");
      expect(remote.deliveryCommand).not.toHaveBeenCalled();
      expect(remote.connectionCommand).not.toHaveBeenCalled();
    } finally {
      await view.close();
    }
  });
  it("editing the UTC time invalidates consent and the old approval", async () => {
    const view = await mount();
    try {
      await setTime(view.node, new Date(Date.now() + 3_600_000).toISOString().slice(0, 16));
      await click(view.node, "Preview example approval");
      await act(async () =>
        view.node.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
      );
      await setTime(view.node, new Date(Date.now() + 7_200_000).toISOString().slice(0, 16));
      expect(view.node.textContent).toContain("approval is stale");
      expect(
        view.node.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked
      ).toBe(false);
      expect(
        Array.from(view.node.querySelectorAll("button")).find(
          (b) => b.textContent === "Simulate approved scheduling — no send"
        )!.disabled
      ).toBe(true);
    } finally {
      await view.close();
    }
  });
  it("an OAuth callback parameter never auto-finishes or connects, and disabled feature cannot approve", async () => {
    window.history.replaceState(null, "", "/?buffer=finish");
    const view = await mount({ ...props, demo: false });
    try {
      expect(view.node.textContent).toContain("Scheduling is not enabled");
      expect(remote.connectionCommand).not.toHaveBeenCalled();
      const finish = Array.from(view.node.querySelectorAll("button")).find(
        (b) => b.textContent === "Finish connection for this signed-in account"
      )!;
      expect(finish.disabled).toBe(true);
    } finally {
      await view.close();
    }
  });
});
