import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import type { ProductProfile } from "@/lib/types";

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
  const set = (patch: Partial<ProductProfile>) =>
    setProfile({ ...profile, ...patch });

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="mb-1 text-lg font-semibold">Product profile</h2>
        <p className="mb-4 text-xs text-neutral-500">
          We read this off your page — edit anything that&apos;s off before the
          strategy runs.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" value={profile.name} onChange={(v) => set({ name: v })} />
          <Field label="Tagline" value={profile.tagline} onChange={(v) => set({ tagline: v })} />
          <Field label="Audience" value={profile.audience} onChange={(v) => set({ audience: v })} />
          <Field label="Category" value={profile.category} onChange={(v) => set({ category: v })} />
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
            set({ differentiators: v.split(",").map((s) => s.trim()).filter(Boolean) })
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
