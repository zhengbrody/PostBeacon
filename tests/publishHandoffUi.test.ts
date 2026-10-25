// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlinePostWorkbench } from "@/components/app/results/InlinePostWorkbench";
import { DEMO_PROJECT } from "@/lib/demo";

afterEach(() => vi.unstubAllGlobals());

async function mount(body = "Check a sample job and review its status.") {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props: ComponentProps<typeof InlinePostWorkbench> = {
    content: {
      ...DEMO_PROJECT.result.content[0],
      platformId: "twitter",
      platformName: "X / Twitter",
      posts: [{ ...DEMO_PROJECT.result.content[0].posts[0], hook: "Meet Cronwise", body }],
    },
    facts: DEMO_PROJECT.facts,
    profile: { ...DEMO_PROJECT.profile, publisherVoice: "brand" },
    posted: {},
    loading: false,
    onUpdatePost: vi.fn(),
    onRegenerate: vi.fn(),
    onPublish: vi.fn(),
    onAskCopilot: vi.fn(),
    onOpenLibrary: vi.fn(),
  };
  const render = async (patch: Partial<typeof props> = {}) => {
    Object.assign(props, patch);
    await act(async () => root.render(createElement(InlinePostWorkbench, props)));
  };
  await render();
  const button = (label: string) => {
    const element = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === label
    );
    if (!element) throw new Error(`Button not found: ${label}`);
    return element;
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

describe("explicit publishing handoff", () => {
  it("discloses transmission before clicking, uses current text and never records publish", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const view = await mount();
    try {
      expect(view.container.textContent).toContain("browser history");
      expect(open).not.toHaveBeenCalled();
      const body = "Review this updated sample instead.";
      await view.render({
        content: {
          ...view.props.content,
          posts: [{ ...view.props.content.posts[0], hook: "Meet Cronwise", body }],
        },
      });
      await act(async () => view.button("Send draft to X composer ↗").click());
      const [href, target, features] = open.mock.calls[0];
      const url = new URL(String(href));
      expect(url.origin).toBe("https://twitter.com");
      expect(url.searchParams.get("text")).toBe(`Meet Cronwise\n\n${body}`);
      expect(target).toBe("_blank");
      expect(features).toBe("noopener,noreferrer");
      expect(view.container.textContent).toContain("Nothing is marked published here");
      expect(view.container.textContent).not.toContain("Popup blocked");
      expect(view.props.onPublish).not.toHaveBeenCalled();
      expect(view.props.onUpdatePost).not.toHaveBeenCalled();
      expect(view.props.posted).toEqual({});
    } finally {
      open.mockRestore();
      await view.close();
    }
  });

  it("does not send blocked claims to the composer", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const view = await mount("Trusted by 90000 users. Try [insert URL].");
    try {
      expect(view.button("Open X / Twitter").disabled).toBe(true);
      await act(async () => view.button("Open X / Twitter").click());
      expect(open).not.toHaveBeenCalled();
      expect(view.props.onPublish).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      await view.close();
    }
  });

  it("keeps threads complete on a manual path, without sending a partial prefill", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const body = `${"a".repeat(160)}\n\n${"b".repeat(160)}`;
    const view = await mount(body);
    try {
      expect(view.container.textContent).toContain("This draft needs a thread");
      expect(view.container.textContent).toContain(body);
      await act(async () => view.button("Open X / Twitter").click());
      expect(open).toHaveBeenCalledWith(
        "https://x.com/compose/post",
        "_blank",
        "noopener,noreferrer"
      );
      expect(view.props.onPublish).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      await view.close();
    }
  });

  it("handles a denied opening without marking anything published", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => {
      throw new Error("Denied by browser");
    });
    const view = await mount();
    try {
      await act(async () => view.button("Send draft to X composer ↗").click());
      expect(view.container.textContent).toContain("Could not request the platform window");
      expect(view.props.onPublish).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      await view.close();
    }
  });
});
