import { describe, expect, it } from "vitest";
import { createTrialBrief, briefFactReferences } from "@/lib/trialBrief";
import { normalizeResearchInput } from "@/lib/opportunityResearch";
import { DEMO_PROJECT } from "@/lib/demo";

describe("CMO Brief starting points", () => {
  it("prepares a source-free product-led Brief, not fabricated demand", () => {
    const brief = createTrialBrief(DEMO_PROJECT.profile, DEMO_PROJECT.url);
    expect(brief.mode).toBe("product-led");
    expect(brief.sources).toEqual([]);
    expect(brief.audience).toBe(DEMO_PROJECT.profile.audience);
    expect(brief.steps).toHaveLength(3);
    expect(brief.task).toContain("documented workflow");
    expect(normalizeResearchInput(brief)).toEqual(brief);
  });
  it("never pre-fills a private or secret-bearing trial entry", () => {
    for (const url of ["http://localhost/demo", "https://example.org/?token=private"]) {
      expect(createTrialBrief(DEMO_PROJECT.profile, url).entryUrl).toBe("");
    }
  });
  it("does not mutate profile state or overwrite another Brief", () => {
    const first = createTrialBrief(DEMO_PROJECT.profile, DEMO_PROJECT.url);
    first.task = "My handwritten task";
    const second = createTrialBrief(DEMO_PROJECT.profile, DEMO_PROJECT.url);
    expect(first.task).toBe("My handwritten task");
    expect(second.task).not.toBe(first.task);
    expect(DEMO_PROJECT.profile.name).toBe("Cronwise");
  });
  it("shows only eligible product proof, bounded to three references", () => {
    const references = briefFactReferences(DEMO_PROJECT.facts);
    expect(references).toHaveLength(3);
    expect(
      references.every((reference) => {
        const fact = DEMO_PROJECT.facts.find((item) => item.id === reference.id);
        return (
          fact &&
          ["observed", "user-confirmed"].includes(fact.status) &&
          !["conversionGoal", "stage", "assets"].includes(fact.field ?? "")
        );
      })
    ).toBe(true);
  });
});
