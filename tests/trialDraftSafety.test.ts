// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { trialDraftIssues } from "@/lib/trialDraftSafety";
import { PostCard } from "@/components/app/results/PostCard";
import { ContentTab } from "@/components/app/results/ContentTab";
import { DEMO_PROJECT } from "@/lib/demo";
import type { PlannedExperiment, PlatformPost } from "@/lib/types";

const entry = "https://example.org/try";
const post: PlatformPost = {
  hook: "Try one sample workflow",
  body: `Open the sample and share one confusing step.\n\n${entry}`,
  imageSuggestion: "",
  bestTime: "",
  caveats: "",
};
const plan: PlannedExperiment = {
  id: "research:product",
  templateId: "product-trial",
  sourceExperimentId: "",
  platformId: "twitter",
  platformName: "X / Twitter",
  venue: "Own profile",
  angle: "Try one sample",
  variable: "exploratory",
  heldConstant: "No controlled comparison",
  status: "ready",
  postIdx: 1,
  createdAt: "2026-10-25T00:00:00Z",
  opportunity: {
    mode: "product-led",
    researchId: "research",
    contextKey: "reviewed-context",
    factIds: ["feature"],
    audience: "Developers",
    task: "Try one sample",
    entryUrl: entry,
    steps: ["Open", "Try", "Reply"],
    feedbackQuestion: "What was confusing?",
    rulesUserCheckedAt: "2026-10-25T00:00:00Z",
  },
};

describe("reviewed trial constraints at every draft exit", () => {
  it("accepts the reviewed entry and unchanged context", () => {
    expect(trialDraftIssues("twitter", 1, post, [plan], "reviewed-context")).toEqual([]);
  });
  it("checks the actual draft identity rather than the focused Today card", () => {
    expect(trialDraftIssues("twitter", 0, post, [plan], "changed")).toEqual([]);
    expect(trialDraftIssues("linkedin", 1, post, [plan], "changed")).toEqual([]);
    expect(trialDraftIssues("twitter", 1, post, [plan], "changed")).toHaveLength(1);
  });
  it("fails closed without a current context or a product-led reviewed context", () => {
    expect(trialDraftIssues("twitter", 1, post, [plan])).toHaveLength(1);
    expect(
      trialDraftIssues(
        "twitter",
        1,
        post,
        [{ ...plan, opportunity: { ...plan.opportunity!, contextKey: undefined } }],
        "reviewed-context"
      )
    ).toHaveLength(1);
  });
  it("rejects a safe but unapproved entry before copying or opening a composer", () => {
    const issues = trialDraftIssues(
      "twitter",
      1,
      { ...post, body: `Try it: https://example.org/other` },
      [plan],
      "reviewed-context"
    );
    expect(issues).toContain(
      "The invitation contains an entry link that you did not approve."
    );
    expect(issues).toContain("The approved product entry link is missing.");
  });
  it("rejects banned ordinary claims independently of the generic Truth Gate", () => {
    expect(
      trialDraftIssues(
        "twitter",
        1,
        { ...post, body: `${post.body}\nWorks offline` },
        [plan],
        "reviewed-context",
        ["works offline"]
      )
    ).toContain("The trial kit contains a claim you marked as never to use.");
  });
  it("rechecks editorial defects introduced after queue confirmation", () => {
    expect(
      trialDraftIssues(
        "twitter",
        1,
        { ...post, body: `${post.hook}\n\n${post.body}` },
        [plan],
        "reviewed-context"
      )
    ).toContain(
      "The body repeats the opening hook. Edit the repetition before copying or adding this trial."
    );
    expect(
      trialDraftIssues(
        "twitter",
        1,
        { ...post, body: `${post.body}\nFact: [feature]` },
        [plan],
        "reviewed-context"
      )
    ).toContain(
      "Internal evidence IDs appear in the invitation. Keep citations in the evidence panel, not public copy."
    );
    expect(
      trialDraftIssues(
        "twitter",
        1,
        { ...post, body: `${"x".repeat(281)}\n\n${entry}` },
        [plan],
        "reviewed-context"
      )
    ).toContain(
      "A public-copy segment exceeds this channel's character limit. Shorten it or split it before copying."
    );
  });
  it("preserves source-backed legacy semantics while still enforcing its entry", () => {
    const legacy = {
      ...plan,
      opportunity: { ...plan.opportunity!, mode: undefined, contextKey: undefined },
    };
    expect(trialDraftIssues("twitter", 1, post, [legacy])).toEqual([]);
    expect(
      trialDraftIssues("twitter", 1, { ...post, body: "No link" }, [legacy])
    ).toContain("The approved product entry link is missing.");
  });
  it("ignores cancelled plans without mutating published provenance", () => {
    expect(
      trialDraftIssues("twitter", 1, post, [{ ...plan, status: "cancelled" }], "changed")
    ).toEqual([]);
    expect(
      trialDraftIssues("twitter", 1, post, [{ ...plan, status: "published" }], "changed")
    ).toHaveLength(1);
    expect(plan.opportunity?.contextKey).toBe("reviewed-context");
  });
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});
async function mount(element: ReturnType<typeof createElement>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

describe("library cannot bypass trial review", () => {
  it.each(["repeated opening", "internal citation"])(
    "blocks library Copy and Mark as posted for %s",
    async (defect) => {
      const broken = {
        ...post,
        body:
          defect === "repeated opening"
            ? `${post.hook}\n\n${post.body}`
            : `${post.body}\nFact: [feature]`,
      };
      const dom = await mount(
        createElement(PostCard, {
          post: broken,
          platformId: "twitter",
          postIdx: 1,
          facts: DEMO_PROJECT.facts,
          profile: DEMO_PROJECT.profile,
          posted: false,
          onTogglePosted: vi.fn(),
          onPublish: vi.fn(),
          onUpdate: vi.fn(),
          plans: [plan],
          currentTrialContextKey: "reviewed-context",
        })
      );
      for (const label of ["Copy", "Mark as posted"])
        expect(
          [...dom.querySelectorAll("button")].find((button) => button.textContent === label)
            ?.disabled
        ).toBe(true);
      expect(dom.textContent).toContain(
        defect === "repeated opening"
          ? "The body repeats the opening hook"
          : "Internal evidence IDs appear in the invitation"
      );
    }
  );
  it("blocks individual Copy and Mark as posted for a stale reviewed trial", async () => {
    const onPublish = vi.fn();
    const dom = await mount(
      createElement(PostCard, {
        post,
        platformId: "twitter",
        postIdx: 1,
        facts: DEMO_PROJECT.facts,
        profile: DEMO_PROJECT.profile,
        posted: false,
        onTogglePosted: vi.fn(),
        onPublish,
        onUpdate: vi.fn(),
        plans: [plan],
        currentTrialContextKey: "changed",
      })
    );
    const copy = [...dom.querySelectorAll("button")].find(
      (button) => button.textContent === "Copy"
    )!;
    const publish = [...dom.querySelectorAll("button")].find(
      (button) => button.textContent === "Mark as posted"
    )!;
    expect(copy.disabled).toBe(true);
    expect(publish.disabled).toBe(true);
    expect(dom.textContent).toContain("Product facts or the success goal changed");
    await act(async () => publish.click());
    expect(onPublish).not.toHaveBeenCalled();
  });
  it("blocks bulk copy when any non-focused draft has a changed approved entry", async () => {
    const content = {
      platformId: "twitter",
      platformName: "X / Twitter",
      posts: [post, { ...post, body: "Changed entry: https://example.org/other" }],
    };
    const props: ComponentProps<typeof ContentTab> = {
      orderedContent: [content],
      result: { content: [content], schedule: [] },
      strategy: null,
      facts: DEMO_PROJECT.facts,
      profile: DEMO_PROJECT.profile,
      posted: {},
      loading: false,
      demo: false,
      printing: false,
      onTogglePosted: vi.fn(),
      onRegenerate: vi.fn(),
      onUpdatePost: vi.fn(),
      onUpdateRecommendation: vi.fn(),
      onRemoveChannel: vi.fn(),
      onAddChannel: vi.fn(),
      onRequestPublish: vi.fn(),
      plans: [plan],
      currentTrialContextKey: "reviewed-context",
    };
    const dom = await mount(createElement(ContentTab, props));
    const bulk = [...dom.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Copy all posts")
    )!;
    expect(bulk.disabled).toBe(true);
    expect(dom.textContent).toContain("approved entry restored");
    expect(dom.textContent).toContain(
      "The invitation contains an entry link that you did not approve"
    );
  });
});
