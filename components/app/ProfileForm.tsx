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

  return (
    <div className="space-y-6">
      {diagnosis && (
        <Card className="border-accent-700/50 bg-accent-600/10 p-6">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-accent-300">
              Diagnosis
            </h2>
            {profile.confidence && <ConfidenceTag confidence={profile.confidence} />}
          </div>
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

      <Card className="p-6">
        <h2 className="mb-1 text-lg font-semibold">Product profile</h2>
        <p className="mb-4 text-xs text-neutral-500">
          We read this off your page — edit anything that&apos;s off before the strategy
          runs.
        </p>
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
      </Card>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}>
          ← Start over
        </Button>
        <Button onClick={onNext} disabled={loading}>
          Build my marketing strategy →
        </Button>
      </div>
    </div>
  );
}
