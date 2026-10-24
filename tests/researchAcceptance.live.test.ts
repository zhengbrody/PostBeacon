import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import {
  acceptanceProviders,
  preflightAcceptance,
  runResearchAcceptance,
} from "../scripts/research-acceptance";

// Resolve the explicit workload before local env loading; npm test never spends.
const providers = acceptanceProviders(process.env);

describe.runIf(providers.length > 0)("bounded live C.1 research acceptance", () => {
  it(
    "runs one controlled scenario per selected provider, never a full golden eval",
    { timeout: 60_000 },
    async () => {
      let local: Record<string, string | undefined> = {};
      try {
        local = parseEnv(readFileSync(".env.local", "utf8"));
      } catch {
        /* Ambient keys remain usable. */
      }
      for (const key of [
        "OPENAI_API_KEY",
        "OPENAI_MODEL",
        "DEEPSEEK_API_KEY",
        "DEEPSEEK_MODEL",
      ])
        if (!process.env[key] && local[key]) process.env[key] = local[key];
      preflightAcceptance(providers, process.env);
      const { runOpportunityResearch } = await import("@/lib/opportunityResearchServer");
      const reports = [];
      for (const provider of providers)
        reports.push(await runResearchAcceptance(provider, runOpportunityResearch));
      // Metadata/enums only: no raw output, keys, source excerpts or customer data.
      mkdirSync("eval-results", { recursive: true });
      for (const report of reports)
        writeFileSync(
          `eval-results/research-acceptance-${report.provider}.json`,
          JSON.stringify(
            {
              checkedAt: new Date().toISOString(),
              scope:
                "Local provider integration with a controlled scenario; not authenticated production",
              ...report,
            },
            null,
            2
          )
        );
      console.log(
        JSON.stringify({
          scope: "Real provider; controlled scenario and local reducer only",
          productionAccepted: false,
          reports,
        })
      );
      for (const report of reports) {
        expect(report.protocol).toBe("passed");
        expect(report.localContinuity).not.toBe("failed");
      }
    }
  );
});
