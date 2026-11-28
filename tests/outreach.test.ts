import { describe, expect, it } from "vitest";
import { boundedCopilotRequest } from "@/lib/api";
import { DEMO_PROJECT } from "@/lib/demo";
import {
  OUTREACH_LIMITS,
  applyOutreachCommand,
  asOutreachDrafts,
  normalizeOutreach,
  outreachMessageIssues,
  outreachModelInput,
  outreachSuggestions,
  outreachSummary,
  type OutreachCommand,
} from "@/lib/outreach";
import type {
  CopilotRequest,
  OpportunityResearch,
  OutreachContact,
  WorkspaceState,
} from "@/lib/types";

const at = "2026-11-28T10:00:00.000Z";
const context = { facts: DEMO_PROJECT.facts, profile: DEMO_PROJECT.profile };
type Space = Pick<WorkspaceState, "outreach">;
const run = (space: Space, command: OutreachCommand) =>
  applyOutreachCommand(space, command, context);
const ok = (space: Space, command: OutreachCommand): Space => {
  const result = run(space, command);
  if (!result.ok) throw new Error(result.refusal);
  return result.next;
};
const refusal = (space: Space, command: OutreachCommand) => {
  const result = run(space, command);
  return result.ok ? "" : result.refusal;
};
const add = (id = "a", extra: Partial<OutreachCommand & { type: "add" }> = {}) =>
  ({
    type: "add",
    id,
    label: "Founder in a forum thread",
    url: `https://example.com/thread/${id}`,
    need: "Cannot tell which channel to try first",
    origin: "founder",
    at,
    ...extra,
  }) as OutreachCommand;
const one = (space: Space) => space.outreach![0];
const bound = (space: Space) => ({
  contactId: one(space).id,
  revision: one(space).revision,
  at,
});
const MESSAGE =
  "You said choosing a channel is hard. I built a tool for that. Try it once?";
const drafted = () => {
  const space = ok({}, add());
  return ok(space, {
    type: "draft-received",
    message: MESSAGE,
    factIds: [DEMO_PROJECT.facts[0].id, "invented"],
    source: "agent",
    ...bound(space),
  });
};

describe("outreach: the founder sends, the code decides state", () => {
  it("adds a contact as new and keeps the link only when it is a public URL", () => {
    const space = ok({}, add());
    expect(one(space)).toMatchObject({ status: "new", revision: 0, origin: "founder" });
    expect(refusal({}, add("b", { url: "javascript:alert(1)" }))).toContain("https://");
    expect(refusal({}, add("b", { url: "https://user:pw@example.com/" }))).toContain(
      "https://"
    );
    expect(one(ok({}, add("b", { url: "" }))).url).toBeUndefined();
  });

  it("refuses an empty label, a missing need and duplicates", () => {
    expect(refusal({}, add("a", { label: " " }))).toContain("who this is");
    expect(refusal({}, add("a", { need: "short" }))).toContain("needs");
    const space = ok({}, add());
    expect(refusal(space, add("b"))).toBe("");
    expect(refusal(space, add("c", { url: "https://example.com/thread/a" }))).toContain(
      "already on the list"
    );
    const sourced = ok({}, add("s", { sourceId: "src1" }));
    expect(refusal(sourced, add("t", { sourceId: "src1", url: "" }))).toContain(
      "already on the list"
    );
  });

  it("holds at most the list limit", () => {
    let space: Space = {};
    for (let i = 0; i < OUTREACH_LIMITS.contacts; i += 1) space = ok(space, add(`c${i}`));
    expect(refusal(space, add("extra"))).toContain("Remove one");
  });

  it("applies an agent draft, keeps only known fact ids and bumps the revision", () => {
    const space = drafted();
    expect(one(space)).toMatchObject({
      status: "drafted",
      messageSource: "agent",
      revision: 1,
      factIds: [DEMO_PROJECT.facts[0].id],
    });
  });

  it("refuses a late draft after the founder edited or removed the contact", () => {
    const space = ok({}, add());
    const stale = bound(space);
    const edited = ok(space, { type: "edit-message", message: "My own words", ...stale });
    const late: OutreachCommand = {
      type: "draft-received",
      message: MESSAGE,
      factIds: [],
      source: "agent",
      ...stale,
    };
    expect(refusal(edited, late)).toContain("changed since");
    // Even with the current revision, the founder's words are not overwritten.
    expect(refusal(edited, { ...late, ...bound(edited) })).toContain("edited this message");
    expect(one(edited).message).toBe("My own words");
    const removed = ok(space, { type: "remove", ...stale });
    expect(refusal(removed, late)).toContain("changed since");
  });

  it("records sent only for a reviewed message the founder confirms", () => {
    const space = ok({}, add());
    expect(
      refusal(space, { type: "mark-sent", confirmed: true, ...bound(space) })
    ).toContain("no reviewed message");
    const ready = drafted();
    expect(
      refusal(ready, { type: "mark-sent", confirmed: false, ...bound(ready) })
    ).toContain("sent it yourself");
    const sent = ok(ready, { type: "mark-sent", confirmed: true, ...bound(ready) });
    expect(one(sent)).toMatchObject({ status: "sent", sentAt: at });
    // A double click carries the old revision and changes nothing.
    expect(
      refusal(sent, { type: "mark-sent", confirmed: true, ...bound(ready) })
    ).toContain("changed since");
  });

  it("blocks sending a message that reports a result nobody verified", () => {
    const space = ok({}, add());
    const lying = ok(space, {
      type: "edit-message",
      message: "In one experiment, activity picked up in just 72 hours. Try it?",
      ...bound(space),
    });
    expect(
      refusal(lying, { type: "mark-sent", confirmed: true, ...bound(lying) })
    ).toContain("Fix this first");
    const placeholder = ok(space, {
      type: "edit-message",
      message: "Hi [Name], I built this for you.",
      ...bound(space),
    });
    expect(
      refusal(placeholder, { type: "mark-sent", confirmed: true, ...bound(placeholder) })
    ).toContain("placeholder");
  });

  it("keeps a sent message fixed and records only the founder's report of a reply", () => {
    const ready = drafted();
    const sent = ok(ready, { type: "mark-sent", confirmed: true, ...bound(ready) });
    expect(
      refusal(sent, { type: "edit-message", message: "new", ...bound(sent) })
    ).toContain("kept as sent");
    expect(
      refusal(ready, { type: "record-reply", reply: "yes", ...bound(ready) })
    ).toContain("message you sent");
    const silent = ok(sent, { type: "mark-no-reply", ...bound(sent) });
    expect(one(silent).status).toBe("no-reply");
    // A late reply can still be recorded.
    const replied = ok(silent, {
      type: "record-reply",
      reply: "They tried it and asked about pricing",
      ...bound(silent),
    });
    expect(one(replied)).toMatchObject({ status: "replied", closedAt: at });
    expect(outreachSummary(replied.outreach)).toEqual({
      total: 1,
      toReview: 0,
      sent: 1,
      awaiting: 0,
      replied: 1,
    });
  });
});

describe("outreach: what is stored and what reaches a model", () => {
  it("downgrades stored states the machine could not have produced", () => {
    const base = {
      id: "x",
      label: "Someone",
      need: "Needs a clearer first step",
      createdAt: at,
    };
    const [noMessage, noSentAt, junk] = normalizeOutreach([
      { ...base, status: "sent" },
      { ...base, id: "y", status: "replied", message: "hello there", reply: "ok" },
      { ...base, id: "z", status: "weird", url: "ftp://x", message: "hi", revision: -3 },
      { ...base, id: "x" },
      { id: "no-label", need: "long enough need", createdAt: at },
    ]);
    expect(noMessage.status).toBe("new");
    expect(noSentAt).toMatchObject({ status: "drafted" });
    expect(noSentAt.reply).toBeUndefined();
    expect(junk).toMatchObject({ status: "new", revision: 0 });
    expect(junk.url).toBeUndefined();
    expect(normalizeOutreach("nonsense")).toEqual([]);
  });

  it("sends the model the need only: never the label, the link or the real id", () => {
    const space = ok(ok({}, add("real-id-1")), add("real-id-2"));
    const input = outreachModelInput(space.outreach!);
    expect(input.map((p) => p.alias)).toEqual(["c1", "c2"]);
    const wire = JSON.stringify(input.map(({ alias, need }) => ({ alias, need })));
    expect(wire).not.toContain("real-id");
    expect(wire).not.toContain("example.com");
    expect(wire).not.toContain("Founder in a forum");
  });

  it("never sends the people on the list to the Copilot model", () => {
    const space = ok({}, add());
    const bounded = boundedCopilotRequest({
      workspace: { experiments: [], taskLog: [], ...space },
    } as unknown as CopilotRequest);
    expect(bounded.workspace?.outreach).toBeUndefined();
  });

  it("drafts only for contacts without a message, five at a time", () => {
    let space: Space = {};
    for (let i = 0; i < 7; i += 1) space = ok(space, add(`c${i}`));
    expect(outreachModelInput(space.outreach!)).toHaveLength(OUTREACH_LIMITS.draftBatch);
    expect(outreachModelInput(drafted().outreach!)).toEqual([]);
  });

  it("drops model output with a bad alias, no text or a placeholder", () => {
    expect(
      asOutreachDrafts({
        messages: [
          { id: "c1", message: "A real message", factIds: ["f1", 2] },
          { id: "c9", message: "wrong alias" },
          { id: "c2", message: "" },
          { id: "c3", message: "Hi [Name], try it" },
        ],
      })
    ).toEqual([{ alias: "c1", message: "A real message", factIds: ["f1"] }]);
    expect(asOutreachDrafts(null)).toEqual([]);
  });

  it("flags an over-long message", () => {
    expect(
      outreachMessageIssues("x".repeat(OUTREACH_LIMITS.message + 1), [], null)[0]
    ).toContain("under");
    expect(outreachMessageIssues("  ", [], null)).toEqual(["Write the message first."]);
  });

  it("suggests only research sources with a real quote that are not listed yet", () => {
    const source = (id: string, verification: string) => ({
      id,
      url: `https://forum.example/${id}`,
      quote: "I can never tell which channel is worth my time as a solo founder",
      verification,
      checkedAt: at,
      rules: "unknown",
    });
    const research = {
      sources: [
        source("s1", "quote-found"),
        source("s2", "fetch-failed"),
        source("s3", "user-provided"),
      ],
    } as unknown as OpportunityResearch;
    expect(outreachSuggestions(research, []).map((s) => s.sourceId)).toEqual(["s1", "s3"]);
    const listed = [{ sourceId: "s1" } as OutreachContact];
    expect(outreachSuggestions(research, listed).map((s) => s.sourceId)).toEqual(["s3"]);
    expect(outreachSuggestions({ ...research, example: true }, [])).toEqual([]);
  });
});
