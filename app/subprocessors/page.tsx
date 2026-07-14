import type { Metadata } from "next";
import { LegalShell, LegalSection, LegalTable } from "@/components/legal/LegalShell";
import { activeSubprocessors, providerFallbackNotice } from "@/lib/privacy";

export const metadata: Metadata = {
  title: "Data vendors — PostBeacon",
  description: "The currently configured vendors that can process PostBeacon data.",
};

export default function SubprocessorsPage() {
  const subprocessors = activeSubprocessors();
  return (
    <LegalShell
      title="Data vendors"
      intro="These are the vendors currently configured for this private beta. A vendor only receives the data described below when the related feature is actually used."
    >
      <LegalSection title="Current vendors">
        <LegalTable
          headers={["Vendor", "Role", "Data it can see", "Region", "When"]}
          rows={subprocessors.map((s) => [
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
          You choose a primary AI provider. {providerFallbackNotice()} A failed provider may
          already have received the first attempt.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
