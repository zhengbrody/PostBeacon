import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPreviewHandoff,
  consumePreviewHandoffForAuthReturn,
  markPreviewHandoffAuthPending,
  parsePreviewHandoff,
  PREVIEW_HANDOFF_TTL_MS,
  savePreviewHandoff,
  shouldClearPreviewHandoff,
} from "@/lib/previewHandoff";
import type { GuestPreviewResult } from "@/lib/types";

const preview: GuestPreviewResult = {
  source: { url: "https://example.com/", hostname: "example.com" },
  product: {
    name: "Example",
    tagline: "A useful example",
    valueProp: "Shows the boundary",
    audience: "Founders",
  },
  channel: {
    platformId: "twitter",
    platformName: "X / Twitter",
    score: 82,
    rationale: "The audience is already there.",
    angle: "Show the concrete before and after.",
  },
  draft: {
    hook: "One focused hook",
    body: "One truth-checked body.",
    imageSuggestion: "A product screenshot",
    bestTime: "Tuesday morning",
    caveats: "Do not invent results.",
    truthCheck: "passed",
  },
  provenance: {
    analysis: { provider: "openai", model: "test" },
    scoring: [{ provider: "openai", model: "test" }],
    content: { provider: "openai", model: "test" },
  },
};

describe("preview handoff", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps a valid preview only for the short handoff window", () => {
    const now = Date.parse("2026-07-21T12:00:00.000Z");
    const handoff = createPreviewHandoff("https://example.com/", preview, now);
    expect(parsePreviewHandoff(handoff, now + PREVIEW_HANDOFF_TTL_MS - 1)).toEqual(handoff);
    expect(parsePreviewHandoff(handoff, now + PREVIEW_HANDOFF_TTL_MS)).toBeNull();
  });

  it("rejects malformed or non-truth-checked data", () => {
    const handoff = createPreviewHandoff("https://example.com/", preview, 0);
    expect(
      parsePreviewHandoff(
        {
          ...handoff,
          preview: { ...preview, draft: { ...preview.draft, truthCheck: "failed" } },
        },
        1
      )
    ).toBeNull();
    expect(parsePreviewHandoff({ ...handoff, url: "x" }, 1)).toBeNull();
    expect(
      parsePreviewHandoff({ ...handoff, url: "https://other.example/" }, 1)
    ).toBeNull();
  });

  it("crosses only initial login and clears on a real account boundary", () => {
    expect(shouldClearPreviewHandoff(undefined, null)).toBe(false);
    expect(shouldClearPreviewHandoff(null, "user-a")).toBe(false);
    expect(shouldClearPreviewHandoff(undefined, "user-a")).toBe(false);
    expect(shouldClearPreviewHandoff("user-a", null)).toBe(true);
    expect(shouldClearPreviewHandoff("user-a", "user-b")).toBe(true);
    expect(shouldClearPreviewHandoff("user-a", "user-a")).toBe(false);
  });

  it("crosses authentication only with the matching one-time callback nonce", () => {
    const now = Date.parse("2026-07-21T12:00:00.000Z");
    const handoff = createPreviewHandoff("https://example.com/", preview, now);
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });

    expect(savePreviewHandoff(handoff)).toBe(true);
    const nonce = markPreviewHandoffAuthPending(now + 1);
    expect(nonce).toMatch(/^[a-f0-9]{48}$/);
    expect(consumePreviewHandoffForAuthReturn("wrong", now + 2)).toBeNull();
    expect(consumePreviewHandoffForAuthReturn(nonce!, now + 2)?.url).toBe(
      "https://example.com/"
    );
    expect(consumePreviewHandoffForAuthReturn(nonce!, now + 3)).toBeNull();
  });
});
