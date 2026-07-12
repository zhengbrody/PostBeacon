import {
  FounderChecklistCard,
  IterationCard,
  RisksCard,
} from "@/components/app/PlanSummary";
import { PrintHeading } from "./PrintHeading";
import type { MarketingStrategy } from "@/lib/types";

/** True when the strategy has anything for the Execute tab to show. */
export function hasExecuteContent(strategy: MarketingStrategy | null): boolean {
  return !!(
    strategy?.founderChecklist?.length ||
    strategy?.risks?.length ||
    strategy?.iterationLoop?.length
  );
}

/** The operating side: founder checklist, risks, iteration loop. */
export function ExecuteTab({
  strategy,
  printing,
}: {
  strategy: MarketingStrategy;
  printing: boolean;
}) {
  return (
    <section className="space-y-6">
      {printing && <PrintHeading>Execute</PrintHeading>}
      {strategy.founderChecklist && strategy.founderChecklist.length > 0 && (
        <FounderChecklistCard tasks={strategy.founderChecklist} />
      )}
      {strategy.risks && strategy.risks.length > 0 && <RisksCard risks={strategy.risks} />}
      {strategy.iterationLoop && strategy.iterationLoop.length > 0 && (
        <IterationCard metrics={strategy.iterationLoop} />
      )}
    </section>
  );
}
