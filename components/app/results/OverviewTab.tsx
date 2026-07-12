import {
  AudienceCard,
  LaunchPlanCard,
  PositioningCard,
} from "@/components/app/PlanSummary";
import { PrintHeading } from "./PrintHeading";
import type { MarketingStrategy } from "@/lib/types";

/** The strategic read: positioning (editable), audience, phased plan. */
export function OverviewTab({
  strategy,
  printing,
  onUpdateStrategy,
}: {
  strategy: MarketingStrategy;
  printing: boolean;
  onUpdateStrategy: (patch: Partial<MarketingStrategy>) => void;
}) {
  return (
    <section className="space-y-6">
      {printing && <PrintHeading>Overview</PrintHeading>}
      <PositioningCard strategy={strategy} onUpdate={onUpdateStrategy} />
      {strategy.audienceSegments && strategy.audienceSegments.length > 0 && (
        <AudienceCard segments={strategy.audienceSegments} />
      )}
      {strategy.phases && strategy.phases.length > 0 && (
        <LaunchPlanCard phases={strategy.phases} />
      )}
    </section>
  );
}
