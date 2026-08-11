import { describe, expect, it } from "vitest";
import { DRAFT_SCHEMA_VERSION, migrateDraft, saveDraft } from "@/lib/storage";

describe("draft schema migrations", () => {
  it("reports when browser persistence is unavailable", () => {
    expect(saveDraft({ url: "x.com" })).toBe(false);
  });

  it("stamps a v1 (pre-M11) blob: no selected/launchDate/facts anywhere", () => {
    const d = migrateDraft({ url: "x.com", profile: { name: "X" }, posted: {} })!;
    expect(d.schemaVersion).toBe(DRAFT_SCHEMA_VERSION);
    expect(d.facts).toEqual([]); // structural default added
    expect(d.selected).toBeUndefined(); // derivation stays in the reducer
    expect(d.url).toBe("x.com");
  });

  it("recognizes a v2 (M11) blob by shape and adds the facts default", () => {
    const d = migrateDraft({
      url: "x.com",
      selected: ["reddit"],
      launchDate: "2026-08-01",
    })!;
    expect(d.schemaVersion).toBe(DRAFT_SCHEMA_VERSION);
    expect(d.selected).toEqual(["reddit"]); // preserved, not re-derived
    expect(d.facts).toEqual([]);
  });

  it("passes a current blob through unchanged (idempotent)", () => {
    const current = {
      schemaVersion: DRAFT_SCHEMA_VERSION,
      url: "x.com",
      facts: [{ id: "audience", claim: "devs" }],
      selected: ["hackernews"],
    };
    const once = migrateDraft(current)!;
    const twice = migrateDraft(once)!;
    expect(twice).toEqual(once);
    expect(once.facts).toEqual(current.facts);
  });

  it("v3 (M13) drafts gain an empty workspace (v4 migration)", () => {
    const d = migrateDraft({
      schemaVersion: 3,
      url: "x.com",
      facts: [{ id: "audience", claim: "devs" }],
    })!;
    expect(d.schemaVersion).toBe(DRAFT_SCHEMA_VERSION);
    expect(d.workspace).toEqual({
      experiments: [],
      taskLog: [],
      reminderPreferences: { email: false, updatedAt: "" },
    });
    expect(d.facts).toHaveLength(1); // untouched
  });

  it("v4 drafts keep their workspace and gain the disabled reminder default", () => {
    const workspace = {
      weeklyMinutes: 300,
      experiments: [{ id: "e1" }],
      taskLog: [{ id: "t1" }],
    };
    const d = migrateDraft({ schemaVersion: 4, url: "x.com", workspace })!;
    expect(d.workspace).toEqual({
      ...workspace,
      experiments: [{ id: "e1", outcomes: [] }],
      reminderPreferences: { email: false, updatedAt: "" },
    });
  });

  it("v4 (M15) drafts gain an empty product memory (v5 migration)", () => {
    const d = migrateDraft({
      schemaVersion: 4,
      url: "x.com",
      workspace: { experiments: [{ id: "e1" }], taskLog: [] },
    })!;
    expect(d.schemaVersion).toBe(DRAFT_SCHEMA_VERSION);
    expect(d.memory).toEqual({
      bannedClaims: [],
      angles: [],
      rewriteFeedback: [],
      userEditedFields: [],
    });
    expect(d.workspace?.experiments).toHaveLength(1); // untouched
  });

  it("v5 drafts keep their memory and gain the M18 reminder preference", () => {
    const memory = {
      tone: "dry",
      bannedClaims: ["AI-powered"],
      angles: [],
      rewriteFeedback: [],
      userEditedFields: ["positioning"],
    };
    const d = migrateDraft({ schemaVersion: 5, url: "x.com", memory })!;
    expect(d.memory).toEqual(memory);
    expect(d.workspace?.reminderPreferences).toEqual({ email: false, updatedAt: "" });
  });

  it("v6 keeps an unrecoverable verdict at experiment level", () => {
    const verdict = {
      call: "promising",
      reason: "old final read",
      advice: "continue",
      decidedAt: "2026-07-01T00:00:00.000Z",
    };
    const d = migrateDraft({
      schemaVersion: 6,
      workspace: {
        experiments: [
          {
            id: "legacy",
            outcomes: [{ id: "o1", checkpoint: "24h", recordedAt: verdict.decidedAt }],
            verdict,
          },
        ],
        taskLog: [],
      },
    })!;
    expect(d.workspace?.experiments[0].verdict).toEqual(verdict);
    expect(d.workspace?.experiments[0].outcomes[0].verdict).toBeUndefined();
    expect(d.analysisReceipt).toBeNull();
  });

  it("v8 preserves a bounded analysis receipt across repeated migration", () => {
    const analysisReceipt = {
      completedAt: "2026-08-04T00:00:00.000Z",
      sources: [
        {
          kind: "primary" as const,
          requestedUrl: "example.com",
          canonicalUrl: "https://example.com/",
          status: "fetched" as const,
          method: "static" as const,
        },
      ],
      checks: {
        urlsValidated: 1,
        pagesFetched: 1,
        factsExtracted: 3,
        claimsVerified: 2,
        claimsInferred: 1,
        claimsUnknown: 0,
        claimsDemoted: 0,
      },
      foundAreas: ["features"],
      notFoundAreas: ["pricing"],
      provider: {
        provider: "openai" as const,
        model: "test",
        promptVersion: "a5",
        generatedAt: "2026-08-04T00:00:00.000Z",
      },
      limitation: "submitted extracts only",
    };
    const once = migrateDraft({
      schemaVersion: DRAFT_SCHEMA_VERSION,
      url: "example.com",
      analysisReceipt,
    })!;
    expect(migrateDraft(once)?.analysisReceipt).toEqual(analysisReceipt);
  });

  it("v9 preserves the workspace contract and each experiment snapshot", () => {
    const current = {
      schemaVersion: 9,
      workspace: {
        successContract: {
          primaryGoal: "Free signups / installs",
          primarySignal: "signups",
          minimumResult: 3,
          evaluationWindow: "72h",
        },
        experiments: [
          {
            id: "experiment-1",
            outcomes: [],
            successContract: {
              primaryGoal: "User feedback / conversations",
              primarySignal: "replies",
              minimumResult: 2,
              evaluationWindow: "24h",
            },
          },
        ],
        taskLog: [],
      },
    };
    const migrated = migrateDraft(current)!;
    expect(migrated.workspace?.successContract?.primarySignal).toBe("signups");
    expect(migrated.workspace?.experiments[0].successContract?.primarySignal).toBe(
      "replies"
    );
    expect(migrated.schemaVersion).toBe(DRAFT_SCHEMA_VERSION);
  });

  it("rejects non-object garbage instead of throwing", () => {
    expect(migrateDraft(null)).toBeNull();
    expect(migrateDraft("corrupt")).toBeNull();
    expect(migrateDraft(42)).toBeNull();
  });

  it("never downgrades: a future version keeps its data and gets restamped", () => {
    const d = migrateDraft({ schemaVersion: 99, url: "x.com", facts: [{ id: "f" }] })!;
    expect(d.facts).toEqual([{ id: "f" }]);
  });
});
