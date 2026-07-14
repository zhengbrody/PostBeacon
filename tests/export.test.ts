import { describe, expect, it } from "vitest";
import { toJson, toMarkdown, type ExportSnapshot } from "@/lib/export";
import type { WorkspaceState } from "@/lib/types";

const workspace: WorkspaceState = {
  experiments: [
    {
      id: "e1",
      platformId: "reddit",
      platformName: "Reddit",
      community: "r/selfhosted",
      angle: "the angle",
      variant: "v1",
      hypothesis: "this converts",
      publishedAt: "2026-07-10T09:00:00.000Z",
      status: "analyzed",
      postIdx: 0,
      outcomes: [
        {
          id: "o1",
          checkpoint: "24h",
          recordedAt: "2026-07-11T09:00:00.000Z",
          impressions: 1200,
          replies: 8,
          signups: 2,
          qualitativeFeedback: "asked about pricing",
        },
      ],
      verdict: {
        call: "supported",
        reason: "It converted",
        advice: "keep going",
        decidedAt: "2026-07-11T09:00:00.000Z",
      },
    },
  ],
  taskLog: [],
};

const snap: ExportSnapshot = {
  profile: null,
  strategy: null,
  result: { content: [], schedule: [] },
  workspace,
  memory: {
    tone: "dry",
    bannedClaims: ["AI-powered"],
    angles: [],
    rewriteFeedback: [],
    userEditedFields: [],
  },
};

describe("plan export carries the learning loop (anonymous users' only way out)", () => {
  it("markdown includes the experiment log with metrics, feedback and verdict", () => {
    const md = toMarkdown(snap);
    expect(md).toContain("## Experiment log");
    expect(md).toContain("Reddit · r/selfhosted — 2026-07-10 (analyzed)");
    expect(md).toContain("*Hypothesis:* this converts");
    expect(md).toContain("**24h**: 1200 impressions · 8 replies · 2 signups");
    expect(md).toContain("asked about pricing");
    expect(md).toContain("**Verdict:** supported — It converted");
  });

  it("markdown omits the section when nothing was published", () => {
    expect(toMarkdown({ ...snap, workspace: undefined })).not.toContain(
      "## Experiment log"
    );
    expect(
      toMarkdown({ ...snap, workspace: { experiments: [], taskLog: [] } })
    ).not.toContain("## Experiment log");
  });

  it("json round-trips workspace and memory", () => {
    const parsed = JSON.parse(toJson(snap)) as ExportSnapshot;
    expect(parsed.workspace?.experiments).toHaveLength(1);
    expect(parsed.memory?.bannedClaims).toEqual(["AI-powered"]);
  });
});
