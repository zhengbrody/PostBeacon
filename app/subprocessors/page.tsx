import type { Metadata } from "next";
import { LegalShell, LegalSection, LegalTable } from "@/components/legal/LegalShell";
import { SUBPROCESSORS } from "@/lib/privacy";

export const metadata: Metadata = {
  title: "Subprocessors — PostBeacon",
  description: "Every vendor that can touch PostBeacon data, what it sees, and when.",
};

export default function SubprocessorsPage() {
  return (
    <LegalShell
      title="Subprocessors"
      intro="These are the vendors that can process data when you use PostBeacon. Most are conditional: they only receive anything if the deployment has them configured and your run actually uses them. We’ll update this page before adding a vendor."
    >
      <LegalSection title="Current vendors">
        <LegalTable
          headers={["Vendor", "Role", "Data it can see", "Region", "When"]}
          rows={SUBPROCESSORS.map((s) => [
            <a
              key={s.name}
              href={s.policyUrl}
              className="text-accent-300 hover:underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              {s.name}
            </a>,
            s.role,
            s.data,
            s.region,
            s.when,
          ])}
        />
        <p>
          You choose a primary AI provider. If it fails for availability, credit,
          rate-limit, key, or structured-output reasons, the same prompt may be retried with
          a configured clear-policy provider. DeepSeek is never an automatic fallback; it
          receives data only when explicitly selected as primary (or when it is the sole
          configured provider).
        </p>
      </LegalSection>
    </LegalShell>
  );
}
