import { Card } from "@/components/ui/Card";
import type { Fact, ProductProfile, SuccessContract } from "@/lib/types";
import { successContractSummary } from "@/lib/successContract";

function SummaryField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm leading-relaxed text-neutral-100">
        {value?.trim() || <span className="text-neutral-500">Unknown</span>}
      </dd>
    </div>
  );
}

/** The Diagnose first screen is a decision summary, not a second report. It
 * shows only the product context needed to define the first experiment. */
export function DiagnosisSummary({
  profile,
  facts,
  successContract,
}: {
  profile: ProductProfile;
  facts: Fact[];
  successContract?: SuccessContract;
}) {
  const verified = facts.filter(
    (fact) => fact.status === "observed" || fact.status === "user-confirmed"
  ).length;
  const inferred = facts.filter((fact) => fact.status === "inferred").length;
  const unknown = facts.filter((fact) => fact.status === "unknown").length;

  return (
    <Card className="border-accent-700/40 bg-accent-600/10 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-300">
            Diagnose
          </p>
          <h2 className="mt-1 text-xl font-semibold">Confirm the decision context</h2>
          <p className="mt-1 text-xs text-neutral-400">
            Correct only what changes the first experiment. The full evidence stays one
            level down.
          </p>
        </div>
        <span className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs text-neutral-300">
          {verified} verified · {inferred} inferred · {unknown} unknown
        </span>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <SummaryField label="Product" value={profile.name} />
        <SummaryField label="Audience" value={profile.audience} />
        <SummaryField label="Main value" value={profile.valueProp} />
        <SummaryField
          label="Primary goal"
          value={successContract?.primaryGoal ?? profile.conversionGoal}
        />
      </dl>
      {successContract && (
        <p className="mt-4 border-t border-accent-700/30 pt-3 text-xs text-neutral-400">
          Current decision rule: {successContractSummary(successContract)}
        </p>
      )}
    </Card>
  );
}
