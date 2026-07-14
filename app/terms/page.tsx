import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, LegalSection } from "@/components/legal/LegalShell";
import { providerFallbackNotice } from "@/lib/privacy";

export const metadata: Metadata = {
  title: "Terms of Service — PostBeacon",
  description: "The rules for using PostBeacon during its beta.",
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      intro="These terms govern your use of PostBeacon (postbeacon.app). They’re written to be readable; the bracketed items are placeholders our lawyers still need to settle. By using PostBeacon you agree to them."
    >
      <LegalSection title="1. The service">
        <p>
          PostBeacon analyzes a product URL you supply and generates a launch plan: platform
          scores, positioning, draft posts, a calendar, and a workspace to track what you
          publish yourself. It is currently a <strong>beta</strong>: features change, and
          the service is provided as-is.
        </p>
        <p>
          <strong>PostBeacon never posts anywhere on your behalf.</strong> It has no access
          to your social or community accounts. Publishing anything it drafts is your action
          and your responsibility.
        </p>
      </LegalSection>

      <LegalSection title="2. AI-generated output">
        <p>
          Plans and drafts are produced by AI models and can be wrong, incomplete, or
          unsuitable. The app separates verified facts from inferences where it can, but you
          must review everything before relying on it or posting it. PostBeacon guarantees
          no outcome — no ranking, traffic, signups or revenue — and its output is not
          professional (legal, financial, or marketing-compliance) advice.
        </p>
      </LegalSection>

      <LegalSection title="3. Your responsibilities">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Only analyze URLs you own or have the right to analyze, and only paste content
            (feedback, comments) you may lawfully share with us and our AI providers.
          </li>
          <li>
            When you post generated content, you are the publisher: comply with each
            platform’s rules and applicable law (including ad/disclosure rules).
          </li>
          <li>
            Don’t abuse the service: no attempts to breach security, no scraping the service
            itself, no using it to generate spam, deception, or unlawful content, and no
            automated bulk use beyond the documented limits.
          </li>
          <li>
            Keep your account credentials secure; you’re responsible for its activity.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Your content and IP">
        <p>
          You keep all rights to what you provide (your URL’s content, profile edits, pasted
          feedback, outcome data). You grant us the limited license needed to process it to
          provide the service — including sending it to your selected primary AI provider
          and, if that provider fails, retrying under the disclosed fallback policy — and
          nothing more. {providerFallbackNotice()} To the extent we hold any rights in
          generated output, we assign or waive them in your favor; note that AI output may
          be similar to output generated for others and may embed facts from your own page.
        </p>
        <p>
          We do not use your content to train models or to build cross-user datasets. Any
          future aggregate learning from anonymized outcome data would require your
          separate, explicit, revocable opt-in, as described in the{" "}
          <Link href="/privacy" className="text-accent-300 hover:underline">
            privacy page
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="5. Accounts, fees, termination">
        <p>
          Accounts are optional during the beta. If paid plans are enabled, checkout and
          billing run through Polar as merchant of record; prices and limits are shown
          before you buy. You can stop using the service and delete your account at any time
          from the app; we may suspend or terminate accounts that violate these terms. On
          deletion, your data is removed as described in the privacy page.
        </p>
      </LegalSection>

      <LegalSection title="6. Disclaimers and liability">
        <p>
          The service is provided “as is” and “as available”, without warranties of any
          kind, express or implied, including merchantability, fitness for a particular
          purpose, and non-infringement. To the maximum extent permitted by law, our total
          liability for any claim arising out of the service is limited to the greater of
          the amount you paid us in the twelve months before the claim and USD 50, and we
          are not liable for indirect, incidental, special, consequential or exemplary
          damages.{" "}
          <em>[Pending legal review: enforceability and consumer-law carve-outs.]</em>
        </p>
      </LegalSection>

      <LegalSection title="7. Governing law and disputes">
        <p>
          <em>
            [Pending legal review: governing law, venue, and dispute-resolution mechanism to
            be determined by counsel.]
          </em>
        </p>
      </LegalSection>

      <LegalSection title="8. Changes">
        <p>
          We may update these terms as the product evolves; the date at the top moves when
          we do, and material changes will be visible in the app. Continuing to use
          PostBeacon after a change means you accept the updated terms.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
