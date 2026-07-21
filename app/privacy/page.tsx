import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, LegalSection, LegalTable } from "@/components/legal/LegalShell";
import {
  accountsConfigured,
  configuredProviderPrivacy,
  deepseekAutomaticFallbackEnabled,
  guestPreviewConfigured,
  providerFallbackNotice,
  retentionDays,
  visibleDataCategories,
} from "@/lib/privacy";

export const metadata: Metadata = {
  title: "Privacy — PostBeacon",
  description:
    "What PostBeacon stores, what goes to the AI model you pick, and how to export or delete everything.",
};

export default function PrivacyPage() {
  const retention = retentionDays();
  const deepseekFallback = deepseekAutomaticFallbackEnabled();
  const dataCategories = visibleDataCategories();
  const providerPrivacy = configuredProviderPrivacy();
  const guestPreview = guestPreviewConfigured();
  const accounts = accountsConfigured();
  return (
    <LegalShell
      title="Privacy"
      intro="PostBeacon turns your product URL into a launch plan. That means it handles your product’s page text, the profile built from it, and — if you use the workspace — the results you type in. This page says plainly where each piece lives, which vendors see it, and how to get it out or delete it."
    >
      <LegalSection title="The short version">
        <ul className="list-disc space-y-1.5 pl-5">
          {guestPreview ? (
            <li>
              Not signed in? The one-channel preview is processed by the server and AI
              provider, but is <strong>not written to the projects database</strong>. Its
              result stays in this browser for up to one hour so you can explicitly continue
              after signing in.
            </li>
          ) : !accounts ? (
            <li>
              In local-only mode, your draft lives in{" "}
              <strong>your browser’s localStorage</strong>, not on our servers.
            </li>
          ) : (
            <li>
              The fictional walkthrough is never saved. Sign in before analyzing your own
              URL or saving a project.
            </li>
          )}
          <li>
            Signed in? Projects are saved to our database (Supabase) in rows{" "}
            <strong>only your account can read</strong>.
          </li>
          <li>
            Your page text, profile, plan context and anything you paste to the copilot are{" "}
            <strong>sent to your primary AI model</strong> to generate output.{" "}
            {providerFallbackNotice()}
          </li>
          <li>
            We <strong>never post to any platform for you</strong>, set no advertising
            cookies, and{" "}
            <strong>
              don’t use your content to train models or build cross-user datasets
            </strong>
            .
          </li>
          <li>
            You can export everything as JSON and delete a project or your whole account
            from inside the app.
          </li>
          <li>
            In-app action reminders are automatic. Event emails are off unless you
            explicitly enable them, and can be switched off from the workspace.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="What we handle, where it lives">
        <LegalTable
          headers={["Data", "Where", "Why", "Kept", "How to delete"]}
          rows={dataCategories.map((c) => [
            c.what,
            c.where,
            c.why,
            c.retention,
            c.deletion,
          ])}
        />
      </LegalSection>

      <LegalSection title="AI models and your data">
        <p>
          Generation starts on the primary model you pick. Prompts include your page’s
          extracted text, the profile, relevant plan context, and text you paste to the
          copilot. If that provider is unavailable, out of credit, rate-limited,
          misconfigured, or cannot return usable structured output, PostBeacon may retry the
          same prompt with another configured provider. A failed provider may already have
          received the first attempt.{" "}
          {deepseekFallback && (
            <>
              During this beta, automatic fallback can include DeepSeek and China
              processing.
            </>
          )}{" "}
          We don’t store chat transcripts; each provider retains API data per its own
          policy:
        </p>
        <LegalTable
          headers={["Model", "Region", "Published API policy (as we read it)"]}
          rows={providerPrivacy.map((p) => [
            <a
              key={p.label}
              href={p.policyUrl}
              className="text-accent-300 hover:underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              {p.label}
            </a>,
            p.region,
            p.note,
          ])}
        />
        <p>
          Where a provider’s policy doesn’t clearly exclude training use, we never make it
          the default and we label it in the model picker. If your product is still
          confidential, don’t paste anything you wouldn’t want retained.
          {deepseekFallback &&
            " During this beta, DeepSeek may also be used as the disclosed automatic fallback; avoid confidential material."}
        </p>
      </LegalSection>

      <LegalSection title="What we deliberately don’t do">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>No auto-posting.</strong> PostBeacon never holds your social accounts’
            credentials and never publishes on your behalf — you copy and post.
          </li>
          <li>
            <strong>No training on your content, no cross-user aggregation.</strong> Your
            plans and outcomes are used only to serve you. If we ever want to learn from
            anonymized outcome data in aggregate, that will be a separate, explicit,
            revocable opt-in — de-identified and only computed over large cohorts — and off
            by default.
          </li>
          <li>
            <strong>No ad tech.</strong> Analytics are cookieless and aggregated (Vercel Web
            Analytics). We don’t sell or share personal information for advertising.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Your controls">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Clear browser preview or draft</strong> — removes the temporary guest
            preview or local-only draft from this device.
          </li>
          <li>
            <strong>Export my data</strong> — in the app’s “Data &amp; privacy” menu:
            downloads your account’s projects, experiments, outcomes, tasks and plan status
            as one JSON file.
          </li>
          <li>
            <strong>Delete a project</strong> — the × beside a saved project; its
            experiments, outcomes and tasks are deleted with it.
          </li>
          <li>
            <strong>Delete my account</strong> — in “Data &amp; privacy”: removes your
            projects, workspace data, usage records and the account itself. If a deployment
            can’t perform a full deletion, the app says so instead of pretending.
          </li>
        </ul>
        <p>
          Residual copies can persist briefly in encrypted database backups until those
          backups age out on the vendor’s schedule.
        </p>
      </LegalSection>

      <LegalSection title="Retention">
        {retention ? (
          <p>
            This deployment automatically deletes signed-in projects untouched for{" "}
            <strong>{retention} days</strong> (and internal webhook receipts of the same
            age). Browser-only preview and draft retention is listed in the inventory above.
          </p>
        ) : (
          <p>
            This deployment runs no automatic deletion: your saved projects are kept until
            you delete them. Browser-only preview and draft retention is listed in the
            inventory above.
          </p>
        )}
      </LegalSection>

      <LegalSection title="Vendors and transfers">
        <p>
          The full list of vendors that touch data, what each sees, and when, is on the{" "}
          <Link href="/subprocessors" className="text-accent-300 hover:underline">
            data-vendors page
          </Link>
          . Hosting is on Vercel (US); if you’re outside the US your data is processed there
          and by the model provider’s region shown above.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We’ll update this page as the product evolves and bump the date at the top;
          material changes will be visible in the app. During the private beta, please tell
          us if this page does not match what the product actually does.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
