import { describe, expect, it } from "vitest";
import { contractForPrompt } from "@/lib/generate";
import type { SuccessContract } from "@/lib/types";

const contract: SuccessContract = {
  primaryGoal: "User feedback / conversations",
  primarySignal: "qualifiedReplies",
  baseline: 0,
  minimumResult: 3,
  evaluationWindow: "72h",
};

describe("contractForPrompt", () => {
  it("tells the model nothing has run and gives the goal and the signal", () => {
    const text = contractForPrompt(contract);
    expect(text).toContain("no experiment has run");
    expect(text).toContain("User feedback / conversations");
    expect(text).toContain("qualifiedReplies");
  });

  it("keeps the target number and the time window out of the draft prompt", () => {
    const text = contractForPrompt({ ...contract, minimumResult: 41, baseline: 17 });
    expect(text).not.toMatch(/72/);
    expect(text).not.toMatch(/41|17/);
    expect(text).not.toContain("evaluationWindow");
  });

  it("uses the founder's own label for a custom signal", () => {
    expect(
      contractForPrompt({
        ...contract,
        primarySignal: "custom",
        customSignalLabel: "Demo calls booked",
      })
    ).toContain("Demo calls booked");
  });

  it("forbids invented results when no goal is set", () => {
    expect(contractForPrompt()).toContain("do not report any result");
  });
});
