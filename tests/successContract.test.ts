import { describe, expect, it } from "vitest";
import {
  defaultSuccessContract,
  normalizeSuccessContract,
  successContractSummary,
} from "@/lib/successContract";
import { verdictFor } from "@/lib/today";
import type { Outcome, SuccessContract } from "@/lib/types";

const contract: SuccessContract = {
  primaryGoal: "Free signups / installs",
  primarySignal: "signups",
  baseline: 2,
  minimumResult: 5,
  evaluationWindow: "72h",
};

const outcome = (over: Partial<Outcome>): Outcome => ({
  id: "outcome-1",
  checkpoint: "24h",
  recordedAt: "2026-08-04T00:00:00.000Z",
  ...over,
});

const context = {
  platformName: "Reddit",
  angle: "specific pain",
  successContract: contract,
};

describe("Success Contract", () => {
  it("maps visible growth goals to editable, measurable defaults", () => {
    expect(defaultSuccessContract("Waitlist signups")).toMatchObject({
      primarySignal: "signups",
      minimumResult: 1,
      evaluationWindow: "72h",
    });
    expect(defaultSuccessContract("Paying customers").primarySignal).toBe("revenue");
    expect(defaultSuccessContract("Qualified traffic / awareness")).toMatchObject({
      primarySignal: "clicks",
      minimumResult: 10,
    });
    expect(defaultSuccessContract("User feedback / conversations")).toMatchObject({
      primarySignal: "replies",
      minimumResult: 2,
    });
  });

  it("normalizes persisted input and rejects impossible targets", () => {
    expect(normalizeSuccessContract(contract)).toEqual(contract);
    expect(normalizeSuccessContract({ ...contract, minimumResult: 0 })).toBeNull();
    expect(
      normalizeSuccessContract({ ...contract, primarySignal: "followers" })
    ).toBeNull();
    expect(normalizeSuccessContract({ ...contract, baseline: -1 })).toEqual({
      ...contract,
      baseline: undefined,
    });
  });

  it("renders the exact rule without fake confidence precision", () => {
    expect(successContractSummary(contract)).toBe("Signups / installs ≥ 5 by 72h");
  });

  it("reaches the target using only the configured primary signal", () => {
    const verdict = verdictFor(outcome({ signups: 5, impressions: 50_000 }), context);
    expect(verdict.call).toBe("supported");
    expect(verdict.reason).toMatch(/target reached/i);
  });

  it("recognizes baseline improvement without calling the target reached", () => {
    const verdict = verdictFor(outcome({ signups: 3 }), context);
    expect(verdict.call).toBe("promising");
    expect(verdict.reason).toMatch(/directional improvement/i);
    expect(verdict.reason).toMatch(/baseline/i);
  });

  it("waits at 24h, then marks an observed miss at the agreed 72h window", () => {
    const early = verdictFor(outcome({ signups: 0 }), context);
    expect(early.call).toBe("no-signal");
    expect(early.advice).toMatch(/72h/i);

    const final = verdictFor(outcome({ checkpoint: "72h", signups: 0 }), context);
    expect(final.call).toBe("weak");
    expect(final.reason).toMatch(/target missed/i);
  });

  it("treats an unmeasured primary signal as insufficient evidence", () => {
    const verdict = verdictFor(outcome({ clicks: 100 }), context);
    expect(verdict.call).toBe("no-signal");
    expect(verdict.reason).toMatch(/not measured/i);
    expect(verdict.reason).not.toMatch(/target missed/i);
  });
});
