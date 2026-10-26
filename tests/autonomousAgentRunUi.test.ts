import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentRunPanel } from "@/components/app/results/AgentRunPanel";
import { createTrialBrief } from "@/lib/trialBrief";
import { DEMO_PROJECT } from "@/lib/demo";
import type { AgentRun } from "@/lib/agentRuns";

const run = (): AgentRun => ({
  id: "daily-example",
  projectId: "project",
  status: "running",
  phase: "sources",
  provider: "openai",
  createdAt: "2026-10-25T00:00:00Z",
  updatedAt: "2026-10-25T00:00:01Z",
  interrupted: false,
  canResume: false,
  modelAttempted: false,
  checkedSources: 0,
  sourceCount: 0,
  input: createTrialBrief(DEMO_PROJECT.profile, DEMO_PROJECT.url),
  autonomous: true,
  missionRevision: 3,
  searchAttempted: true,
});
function html(patch: Partial<AgentRun>) {
  return renderToStaticMarkup(
    createElement(AgentRunPanel, {
      agent: {
        runs: [{ ...run(), ...patch }],
        enabled: true,
        checking: false,
        error: "",
        busy: false,
        refresh: vi.fn(),
        start: vi.fn(),
        resume: vi.fn(),
        cancel: vi.fn(),
      },
      onReview: vi.fn(),
    })
  );
}
describe("autonomous task receipts stay distinct from source-free product drafts", () => {
  it("shows approved public research rather than claiming no sources are involved", () => {
    const value = html({});
    expect(value).toContain("Approved public research");
    expect(value).toContain("Search attempt reserved; not proof of delivery");
    expect(value).toContain("authorization revision 3");
    expect(value).not.toContain("Input checks / product facts");
    expect(value).not.toContain("no external demand sources");
  });
  it("shows an empty completed search without an invented review action or no-demand verdict", () => {
    const value = html({
      status: "ready",
      phase: "ready",
      searchReceipt: {
        queries: ["background jobs"],
        domains: ["example.org"],
        status: "no-results",
        searchedAt: "2026-10-25T00:00:00Z",
        resultCount: 0,
        candidateCount: 0,
      },
    });
    expect(value).toContain("Result receipt");
    expect(value).toContain("No invitation was invented or queued");
    expect(value).toContain("not evidence of no demand");
    expect(value).toContain("0 results");
    expect(value).toContain("No model request reserved");
    expect(value).not.toContain("Review research");
  });
  it("uses research-specific resume wording before a search has been attempted", () => {
    const value = html({ interrupted: true, canResume: true, searchAttempted: false });
    expect(value).toContain("Resume approved public research");
    expect(value).not.toContain("Resume input checks");
  });
});
