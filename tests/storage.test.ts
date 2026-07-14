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
    expect(d.workspace).toEqual({ experiments: [], taskLog: [] });
    expect(d.facts).toHaveLength(1); // untouched
  });

  it("current (v4) drafts keep their workspace untouched", () => {
    const workspace = {
      weeklyMinutes: 300,
      experiments: [{ id: "e1" }],
      taskLog: [{ id: "t1" }],
    };
    const d = migrateDraft({ schemaVersion: 4, url: "x.com", workspace })!;
    expect(d.workspace).toEqual(workspace);
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

  it("current (v5) drafts keep their memory untouched", () => {
    const memory = {
      tone: "dry",
      bannedClaims: ["AI-powered"],
      angles: [],
      rewriteFeedback: [],
      userEditedFields: ["positioning"],
    };
    const d = migrateDraft({ schemaVersion: 5, url: "x.com", memory })!;
    expect(d.memory).toEqual(memory);
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
