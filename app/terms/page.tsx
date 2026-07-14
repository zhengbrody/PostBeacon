import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, LegalSection } from "@/components/legal/LegalShell";
import { providerFallbackNotice } from "@/lib/privacy";

export const metadata: Metadata = {
  title: "Private beta use — PostBeacon",
  description: "Plain-language expectations for using the PostBeacon private beta.",
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Private beta use"
      intro="This page describes what PostBeacon does today and the basic expectations that keep private-beta testing safe."
    >
      <LegalSection title="1. What the beta does">
        <p>
          PostBeacon analyzes a product URL you supply and generates platform scores,
          positioning, draft posts, a calendar, and a workspace for results you record.
          Features and output may change while the product is being tested.
        </p>
        <p>
          <strong>PostBeacon never posts anywhere on your behalf.</strong> It has no access
          to your social or community accounts. You decide whether to publish anything it
          drafts.
        </p>
      </LegalSection>

      <LegalSection title="2. Review AI output">
        <p>
          AI-generated plans and drafts can be wrong, incomplete, or unsuitable. Review
          facts, claims, links and platform rules before relying on or publishing an output.
          PostBeacon does not promise rankings, traffic, signups, revenue, or professional
          legal, financial or compliance advice.
        </p>
      </LegalSection>

      <LegalSection title="3. Use it responsibly">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Only analyze URLs you own or have permission to analyze.</li>
          <li>
            Only paste feedback or other text that you may share with PostBeacon and the AI
            providers disclosed before a model call.
          </li>
          <li>
            Don’t use the beta for security attacks, spam, deception, unlawful content, or
            automated bulk activity beyond the product’s limits.
          </li>
          <li>Keep your sign-in link and account access secure.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Your content and data">
        <p>
          You keep your rights to the product content, edits, feedback and outcome data you
          provide. PostBeacon processes that material only to run the features you request.{" "}
          {providerFallbackNotice()}
        </p>
        <p>
          We do not use your content to train models or build a cross-user dataset. The{" "}
          <Link href="/privacy" className="text-accent-300 hover:underline">
            privacy page
          </Link>{" "}
          explains storage, providers, export and deletion. Generated output may resemble
          other AI output, so review it before treating it as unique or protectable.
        </p>
      </LegalSection>

      <LegalSection title="5. Accounts and changes">
        <p>
          You can export your account data, delete a project, or delete the account from
          “Data &amp; privacy”. We may change, pause or end beta features as testing
          evolves, and we’ll update these pages when product behavior or data handling
          changes.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
