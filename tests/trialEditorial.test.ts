import { describe, expect, it } from "vitest";
import { trialEditorialIssues } from "@/lib/trialEditorial";

const draft = {
  hook: "Try one real product workflow.",
  body: "Open the sample and tell us which step was unclear.\n\nhttps://example.org/try",
};

describe("trial editorial exit gate", () => {
  it("accepts separate public prose and structured-only provenance", () => {
    expect(trialEditorialIssues(draft, ["manual-draft", "s1"])).toEqual([]);
    expect(
      trialEditorialIssues({ ...draft, body: "Try this feature with a sample." }, [
        "feature",
      ])
    ).toEqual([]);
  });
  it("blocks the hook repeated as the body opening without rewriting it", () => {
    const repeated = { ...draft, body: `${draft.hook}\n\n${draft.body}` };
    expect(trialEditorialIssues(repeated)).toContain(
      "The body repeats the opening hook. Edit the repetition before copying or adding this trial."
    );
    expect(repeated.body.startsWith(draft.hook)).toBe(true);
  });
  it("recognizes punctuation and whitespace variants of the repeated opening", () => {
    expect(
      trialEditorialIssues({
        ...draft,
        body: `TRY ONE REAL PRODUCT WORKFLOW!  ${draft.body}`,
      })
    ).toHaveLength(1);
    expect(
      trialEditorialIssues({ hook: "Try it", body: "Try it with your sample." })
    ).toEqual([]);
  });
  it.each(["Supported by manual-draft.", "Cited fact: [feature].", "Source ID: s1."])(
    "blocks internal citation leakage: %s",
    (body) =>
      expect(
        trialEditorialIssues({ ...draft, body }, ["manual-draft", "feature", "s1"])
      ).toContain(
        "Internal evidence IDs appear in the invitation. Keep citations in the evidence panel, not public copy."
      )
  );
  it("does not match a short ID inside an ordinary word or an approved URL", () => {
    expect(
      trialEditorialIssues(
        {
          ...draft,
          body: "This feature is a manual-draft preview. https://example.org/manual-draft",
        },
        ["s1", "feature"]
      )
    ).toEqual([]);
    expect(
      trialEditorialIssues({ ...draft, body: "Open https://example.org/manual-draft" }, [
        "manual-draft",
      ])
    ).toEqual([]);
  });
  it("checks the actual assembled draft's platform segments, including the hook", () => {
    expect(
      trialEditorialIssues({ ...draft, hook: "h".repeat(281) }, [], "twitter")
    ).toContain(
      "A public-copy segment exceeds this channel's character limit. Shorten it or split it before copying."
    );
    expect(
      trialEditorialIssues({ hook: "h".repeat(200), body: "b".repeat(200) }, [], "twitter")
    ).toEqual([]);
  });
});
