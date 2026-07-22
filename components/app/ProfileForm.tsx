import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ConfidenceTag } from "@/components/ui/Badge";
import type { ProductProfile } from "@/lib/types";

function DiagRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="text-neutral-100">{value}</dd>
    </div>
  );
}

export function ProfileForm({
  profile,
  setProfile,
  loading,
  onBack,
  onNext,
}: {
  profile: ProductProfile;
  setProfile: (p: ProductProfile) => void;
  loading: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const set = (patch: Partial<ProductProfile>) => setProfile({ ...profile, ...patch });

  const diagnosis = profile.whatItIs || profile.whyCare || profile.useCase;
  const goalReady = Boolean(profile.conversionGoal?.trim());

  return (
    <div className="space-y-6">
      {diagnosis && (
        <Card className="border-accent-700/50 bg-accent-600/10 p-6">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-accent-300">
              Working diagnosis
            </h2>
            {profile.confidence && <ConfidenceTag confidence={profile.confidence} />}
          </div>
          <p className="mb-4 text-xs text-neutral-400">
            This is PostBeacon&apos;s interpretation of the page, not a quoted claim. The
            verified facts and your corrections above remain the source of truth.
          </p>
          <dl className="space-y-3 text-sm">
            {profile.whatItIs && (
              <DiagRow label="What it really is" value={profile.whatItIs} />
            )}
            {profile.whyCare && (
              <DiagRow label="Why anyone cares" value={profile.whyCare} />
            )}
            {profile.useCase && (
              <DiagRow label="The moment it's used" value={profile.useCase} />
            )}
          </dl>
          {profile.confidence !== "high" && profile.confidenceNote && (
            <p className="mt-3 border-t border-line pt-3 text-xs text-neutral-400">
              ⚠ Inferred: {profile.confidenceNote}
            </p>
          )}
        </Card>
      )}

      <Card className="overflow-hidden">
        <details>
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 hover:bg-white/[0.02]">
            <span>
              <span className="block text-sm font-semibold text-neutral-100">
                Edit the full product profile
              </span>
              <span className="mt-0.5 block text-xs text-neutral-500">
                Optional · use this when the page was incomplete or the positioning is off
              </span>
            </span>
            <span className="text-xs font-medium text-accent-300">Open editor ↓</span>
          </summary>
          <div className="border-t border-line p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" value={profile.name} onChange={(v) => set({ name: v })} />
              <Field
                label="Tagline"
                value={profile.tagline}
                onChange={(v) => set({ tagline: v })}
              />
              <Field
                label="Audience"
                value={profile.audience}
                onChange={(v) => set({ audience: v })}
              />
              <Field
                label="Category"
                value={profile.category}
                onChange={(v) => set({ category: v })}
              />
            </div>
            <Field
              className="mt-4"
              label="Value proposition"
              textarea
              value={profile.valueProp}
              onChange={(v) => set({ valueProp: v })}
            />
            <Field
              className="mt-4"
              label="Differentiators (comma-separated)"
              value={profile.differentiators?.join(", ") ?? ""}
              onChange={(v) =>
                set({
                  differentiators: v
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
        </details>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="text-sm font-medium text-neutral-100">
            {goalReady ? "Ready to rank the channels" : "One required choice remains"}
          </p>
          <p
            className={`mt-1 text-xs ${goalReady ? "text-neutral-500" : "text-amber-300"}`}
          >
            {goalReady
              ? `The strategy will optimize for ${profile.conversionGoal}.`
              : "Choose a primary growth goal above before building the strategy."}
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack}>
            ← Start over
          </Button>
          <Button onClick={onNext} disabled={loading || !goalReady}>
            Build focused strategy →
          </Button>
        </div>
      </Card>
    </div>
  );
}
