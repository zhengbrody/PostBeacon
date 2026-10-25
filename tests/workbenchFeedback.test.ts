// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlinePostWorkbench } from "@/components/app/results/InlinePostWorkbench";
import { DEMO_PROJECT } from "@/lib/demo";

afterEach(() => vi.unstubAllGlobals());
describe("draft feedback follows actual content, not unrelated loading", () => {
  it("does not announce a new draft after research unless drafts really changed", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const props: ComponentProps<typeof InlinePostWorkbench> = {
      content: DEMO_PROJECT.result.content[0],
      profile: DEMO_PROJECT.profile,
      facts: DEMO_PROJECT.facts,
      posted: {},
      loading: false,
      onUpdatePost: vi.fn(),
      onRegenerate: vi.fn(),
      onPublish: vi.fn(),
      onAskCopilot: vi.fn(),
      onOpenLibrary: vi.fn(),
    };
    const render = async (patch: Partial<typeof props>) =>
      act(async () =>
        root.render(createElement(InlinePostWorkbench, { ...props, ...patch }))
      );
    try {
      await render({});
      await render({ loading: true });
      await render({ loading: false });
      expect(container.textContent).not.toContain("Fresh draft generated");
      await render({ loading: true });
      const content = {
        ...props.content,
        posts: props.content.posts.map((post, i) =>
          i ? post : { ...post, body: post.body + " New version." }
        ),
      };
      await render({ loading: false, content });
      expect(container.textContent).toContain("Fresh draft generated");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
