"use client";

import { useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button, ButtonLink } from "@/components/ui/Button";
import {
  normalizeResearchInput,
  researchContextKey,
  trialSafety,
} from "@/lib/opportunityResearch";
import { createTrialBrief, briefFactReferences } from "@/lib/trialBrief";
import { successContractSummary } from "@/lib/successContract";
import { isSafeExternalHref } from "@/lib/urlPolicy";
import { PROVIDER_PRIVACY } from "@/lib/privacy";
import { AgentRunPanel } from "./AgentRunPanel";
import { CmoBrief } from "./CmoBrief";
import type { GrowthAgentControls } from "@/hooks/useGrowthAgent";
import type {
  Fact,
  OpportunityResearch,
  PlannedExperiment,
  ProductProfile,
  Provider,
  SuccessContract,
  TrialResearchInput,
} from "@/lib/types";

const sourceLabel = {
  "user-provided": "User-provided excerpt — not independently fetched",
  "quote-found": "Exact quote found in the submitted page extract",
  "quote-not-found": "Quote not found in the available extract — excluded",
  "fetch-failed": "Could not read this source — excluded",
};

export function OpportunityWorkbench({
  profile,
  facts,
  bannedClaims,
  contract,
  productUrl,
  provider,
  research,
  queue,
  draftCounts,
  loading,
  demo,
  onResearch,
  onClear,
  onQueue,
  agent,
  onReviewAgent,
}: {
  profile: ProductProfile;
  facts: Fact[];
  bannedClaims: string[];
  contract: SuccessContract;
  productUrl: string;
  provider: Provider;
  research?: OpportunityResearch;
  queue: PlannedExperiment[];
  loading: boolean;
  demo: boolean;
  draftCounts: Record<string, number>;
  onResearch: (input: TrialResearchInput, deepseekConsent?: boolean) => void;
  agent: GrowthAgentControls;
  onReviewAgent: (id: string) => void;
  onClear: () => void;
  onQueue: (
    researchId: string,
    opportunityId: string,
    rulesChecked: boolean,
    trialChecked: boolean
  ) => void;
}) {
  const [open, setOpen] = useState(true);
  const [input, setInput] = useState<TrialResearchInput>(
    () => research?.input ?? createTrialBrief(profile, productUrl)
  );
  // Saved/reviewed venues are intentional input. Only a fresh untouched default
  // may become platform-neutral when the publishing channel changes.
  const venueEdited = useRef(Boolean(research));
  const [selected, setSelected] = useState<string>();
  const [rulesChecked, setRulesChecked] = useState(false);
  const [trialChecked, setTrialChecked] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [deepseekConsent, setDeepseekConsent] = useState(false);
  const opportunity = research?.opportunities.find((item) => item.id === selected);
  const source = research?.sources.find((item) => item.id === opportunity?.sourceId);
  const productLedResult = research?.input.mode === "product-led";
  const oversizedContext = Boolean(research && research.contextKey.length > 50_000);
  const stale = Boolean(
    research &&
    research.contextKey !==
      researchContextKey(profile, facts, contract, productUrl, bannedClaims)
  );
  const inputsChanged = Boolean(
    research &&
    JSON.stringify(normalizeResearchInput(input)) !==
      JSON.stringify(normalizeResearchInput(research.input))
  );
  const issues =
    research && opportunity
      ? trialSafety(research, opportunity.id, facts, profile, bannedClaims)
      : [];
  const confirmedPlan = queue.find((plan) => plan.id === selected);
  const activeBriefStep =
    research && !stale && !inputsChanged
      ? queue.some(
          (plan) =>
            plan.status !== "cancelled" &&
            research.opportunities.some((candidate) => candidate.id === plan.id)
        )
        ? 3
        : 2
      : 1;
  const capacity =
    queue.length >= 40 ||
    Boolean(research && (draftCounts[research.input.platformId] ?? 0) >= 12);
  const canConfirm =
    !loading &&
    !stale &&
    !oversizedContext &&
    !inputsChanged &&
    !issues.length &&
    rulesChecked &&
    trialChecked &&
    !confirmedPlan &&
    !capacity;
  const verifiedFacts = briefFactReferences(facts);
  const readyInput = normalizeResearchInput(input);
  const update = (patch: Partial<TrialResearchInput>) => {
    if (patch.venue !== undefined) venueEdited.current = true;
    setSelected(undefined);
    setDeepseekConsent(false);
    setRulesChecked(false);
    setTrialChecked(false);
    setCopyStatus("");
    setInput((current) => ({
      ...current,
      ...patch,
      ...(patch.platformId !== undefined &&
      patch.platformId !== current.platformId &&
      !venueEdited.current &&
      current.venue === "Own X profile"
        ? { venue: "Own profile" }
        : {}),
    }));
  };
  const select = (id: string) => {
    setSelected(id);
    setRulesChecked(false);
    setTrialChecked(false);
    setCopyStatus("");
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus("Copied. Publish manually; this did not post anything.");
    } catch {
      setCopyStatus("Clipboard unavailable. Select the visible text and copy it manually.");
    }
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent-300">
            Growth Agent · your CMO workbench
          </p>
          <h3 className="text-xl font-semibold sm:text-2xl">
            Prepare one useful product trial
          </h3>
        </div>
        <span className="rounded-full border border-line px-3 py-1 text-xs text-neutral-400">
          {demo ? "Interactive example" : "Approval required"}
        </span>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-neutral-400">
        Tell PostBeacon who should try one task. Get an invitation, trial steps and a
        feedback question — then review it into Today. No automatic posting or outreach.
      </p>
      <ol
        aria-label="Trial preparation flow"
        className="mt-5 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3"
      >
        {[
          ["Your Brief", "Three quick decisions"],
          ["Review a trial kit", "Draft, entry, steps and evidence"],
          [
            "Put it into Today",
            activeBriefStep === 3
              ? "Confirmed in your workspace; publishing stays manual"
              : "You approve; you publish",
          ],
        ].map(([label, detail], index) => (
          <li
            key={label}
            aria-current={activeBriefStep === index + 1 ? "step" : undefined}
            className={`rounded-lg border p-3 ${activeBriefStep === index + 1 ? "border-accent-500/40 bg-accent-500/5" : "border-line"}`}
          >
            <span
              className={`font-medium ${activeBriefStep === index + 1 ? "text-accent-300" : ""}`}
            >
              {index + 1} · {label}
              {activeBriefStep > index + 1 ? " · reviewed" : ""}
            </span>
            <span className="mt-1 block text-neutral-400">{detail}</span>
          </li>
        ))}
      </ol>
      {!demo && (
        <AgentRunPanel
          agent={agent}
          onReview={(id) => {
            const run = agent.runs.find((item) => item.id === id);
            if (run) {
              venueEdited.current = true;
              setInput(run.input);
            }
            setSelected(undefined);
            setDeepseekConsent(false);
            setRulesChecked(false);
            setTrialChecked(false);
            setCopyStatus("");
            setOpen(true);
            onReviewAgent(id);
          }}
        />
      )}
      <Button className="mt-4 min-h-11" variant="ghost" onClick={() => setOpen(!open)}>
        {open ? "Collapse Brief & trial kit" : "Open CMO Brief & trial kit"}
      </Button>
      {open && (
        <div className="mt-4 space-y-5">
          <CmoBrief input={input} contract={contract} onChange={update} />
          {input.mode === "product-led" && (
            <p className="rounded-lg border border-line bg-surface-2 p-3 text-xs text-neutral-400">
              Product-facts mode · no external demand evidence. This prepares a test
              invitation; it does not mean people, customer demand or venue permission were
              found.
            </p>
          )}
          <details className="text-xs text-neutral-500">
            <summary className="cursor-pointer py-2">
              What will be used, sent and stored?
            </summary>
            <div className="space-y-3 py-2">
              <p>
                {demo
                  ? "Fictional example — never saved; no source fetching or model calls."
                  : `At most 3 explicit sources and 1 model request (20s timeout, no automatic retry/fallback). The Brief, excerpts and verified product facts go to ${PROVIDER_PRIVACY[provider].label}. ${PROVIDER_PRIVACY[provider].note} Task inputs and results are stored with your project.`}
              </p>
              <p>
                No private messages, handles, emails or confidential data. No whole-site
                crawling, automatic posting or outreach.
              </p>
              {!demo && (
                <p>
                  At most 10 tasks per account and 100 shared tasks per UTC day. Maximum 1
                  model request and 2,600 output tokens per task. Reservations are not
                  refunded for cancellation or failure. These are request limits, not exact
                  dollar budgets.
                </p>
              )}
              {verifiedFacts.length > 0 && (
                <ul className="list-inside list-disc space-y-1">
                  {verifiedFacts.map((fact) => (
                    <li key={fact.id}>
                      {fact.id}: {fact.claim}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
          {demo && (
            <p className="text-xs text-accent-300">
              Example data — never saved. Editing this Brief changes the fictional
              walkthrough, not a real Agent task.
            </p>
          )}
          {!demo && provider === "deepseek" && (
            <label className="flex items-start gap-2 text-sm text-amber-300">
              <input
                type="checkbox"
                checked={deepseekConsent}
                onChange={(event) => setDeepseekConsent(event.target.checked)}
              />
              I agree to send this Brief, public excerpts and product facts to DeepSeek,
              which processes data in China. No confidential information.
            </label>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              className="min-h-11"
              disabled={
                loading ||
                agent.busy ||
                !readyInput ||
                (!demo &&
                  (!agent.enabled ||
                    provider === "claude" ||
                    (provider === "deepseek" && !deepseekConsent)))
              }
              onClick={() => {
                setSelected(undefined);
                setRulesChecked(false);
                setTrialChecked(false);
                setCopyStatus("");
                onResearch(input, deepseekConsent);
              }}
            >
              {loading || agent.busy
                ? "Please wait…"
                : demo
                  ? "Preview fictional trial kit →"
                  : "Prepare my trial kit →"}
            </Button>
            {!demo && !agent.checking && !agent.enabled && (
              <ButtonLink href="/app?demo=1" variant="outline" className="min-h-11">
                Explore the fictional walkthrough
              </ButtonLink>
            )}
          </div>
          {!readyInput && (
            <p role="status" className="text-xs text-amber-300">
              Complete the three Brief fields and review the public entry, venue and all
              three steps. Evidence mode also needs a valid public source and a 30–400
              character excerpt.
            </p>
          )}
          {!demo && provider === "claude" && (
            <p role="status" className="text-sm text-amber-300">
              Choose OpenAI or DeepSeek in the model picker. Claude is not enabled for trial
              research.
            </p>
          )}
          {research && (
            <section
              aria-label="Prepared trial kits"
              className="space-y-4 border-t border-line pt-5"
            >
              <p className="text-xs text-neutral-400">
                {research.example
                  ? "Example data — no model call."
                  : research.meta
                    ? `Actual provider: ${research.meta.provider} / ${research.meta.model}.`
                    : "No model call: none of the submitted excerpts could be used."}{" "}
                A prepared kit is not a completed promotion.
              </p>
              {inputsChanged && (
                <p role="status" className="text-sm text-amber-300">
                  Your Brief edits have not been applied to these results. Prepare a new kit
                  before confirming or copying.
                </p>
              )}
              {stale && (
                <p role="alert" className="text-sm text-amber-300">
                  Product evidence or success definition changed. Prepare a new kit before
                  confirming this one.
                </p>
              )}
              {oversizedContext && (
                <p role="alert" className="text-sm text-amber-300">
                  This evidence context exceeds the saved-trial limit. Reduce the product
                  context and prepare a new kit before adding it to Today.
                </p>
              )}
              {productLedResult && (
                <p className="rounded-lg border border-amber-500/30 p-3 text-sm text-amber-300">
                  No external demand evidence. This kit is based on product facts and your
                  proposed task, not a discovered customer or verified community
                  opportunity.
                </p>
              )}
              {research.sources.map((item) => (
                <div key={item.id} className="rounded-lg border border-line p-3 text-sm">
                  {isSafeExternalHref(item.url) && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-accent-300"
                    >
                      Demand evidence source ↗
                    </a>
                  )}
                  <p className="mt-2 text-xs text-neutral-400">
                    {sourceLabel[item.verification]}
                    {item.truncated ? " · extract truncated" : ""} · venue rules unknown
                  </p>
                  <blockquote className="mt-2 break-words text-neutral-300">
                    {item.quote}
                  </blockquote>
                  <p className="mt-1 text-xs text-neutral-500">
                    Checked: {item.checkedAt || "not recorded"}; publication date unknown.
                  </p>
                </div>
              ))}
              {research.opportunities.map((candidate) => (
                <div
                  key={candidate.id}
                  className="rounded-xl border border-line bg-surface-2 p-4"
                >
                  <h4 className="font-semibold">One task · {research.input.task}</h4>
                  <p className="mt-2 text-sm text-neutral-400">
                    Fit hypothesis, not an observed conclusion: {candidate.whyFit}
                  </p>
                  <p className="mt-2 text-xs text-neutral-500">
                    Product fact references: {candidate.factIds.join(", ") || "none"}
                  </p>
                  <Button
                    variant="outline"
                    className="mt-3 min-h-11"
                    disabled={loading || stale || inputsChanged}
                    onClick={() => select(candidate.id)}
                  >
                    Review this trial kit
                  </Button>
                </div>
              ))}
              {!research.opportunities.length && (
                <p role="status" className="text-sm text-neutral-400">
                  No safe trial kit was returned. Keep the existing plan, revise the Brief
                  or sources and retry explicitly. No opportunity was invented.
                </p>
              )}
              {opportunity && (productLedResult || source) && (
                <div className="space-y-4 rounded-xl border border-accent-500/40 p-4 sm:p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-accent-300">
                    Your review · trial kit
                  </p>
                  <h4 className="text-lg font-semibold">{research.input.task}</h4>
                  <p className="text-sm text-neutral-400">
                    Audience: {research.input.audience}
                    <br />
                    Publishing venue: {research.input.venue}
                  </p>
                  <div className="rounded-lg border border-line p-3">
                    <p className="text-xs text-neutral-400">
                      Success definition · inherited, not a new promise
                    </p>
                    <p className="mt-1 text-sm">{successContractSummary(contract)}</p>
                  </div>
                  <div>
                    <h5 className="mb-2 text-sm font-medium">Invitation draft</h5>
                    <div className="whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 text-sm">
                      {opportunity.draft.hook}
                      {"\n\n"}
                      {opportunity.draft.body}
                    </div>
                  </div>
                  <div>
                    <h5 className="mb-2 text-sm font-medium">
                      Three proposed trial steps · check in your real product
                    </h5>
                    <ol className="ml-5 list-decimal space-y-2 text-sm">
                      {research.input.steps.map((step, index) => (
                        <li key={index}>{step}</li>
                      ))}
                    </ol>
                  </div>
                  {isSafeExternalHref(research.input.entryUrl) && (
                    <a
                      className="inline-flex min-h-11 items-center break-all text-sm text-accent-300"
                      href={research.input.entryUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open actual trial entry ↗
                    </a>
                  )}
                  <p className="text-sm">
                    Ask for feedback: {research.input.feedbackQuestion}
                  </p>
                  <details className="text-xs text-neutral-400">
                    <summary className="cursor-pointer py-3">
                      Three real screenshot jobs — not generated attachments
                    </summary>
                    <ol className="ml-5 list-decimal space-y-3">
                      {research.input.steps.map((step, index) => (
                        <li key={index}>
                          Capture step {index + 1}: {step}. Show the relevant control or
                          result, not the whole dashboard.
                          <br />
                          Suggested alt text, edit after capture: “{research.input.task},
                          step {index + 1}.”
                        </li>
                      ))}
                    </ol>
                    <p className="mt-3">
                      Use actual product screens. Hide accounts, holdings, tokens and
                      third-party identities. Do not label sample results as real customer
                      outcomes.
                    </p>
                  </details>
                  {issues.length > 0 && (
                    <div role="alert" className="text-sm text-amber-300">
                      Blocked by the current draft gate: {issues.join("; ")}. Confirm facts
                      or change the trial context and prepare again; nothing is queued.
                    </div>
                  )}
                  <label className="flex min-h-11 items-center gap-2 text-xs text-neutral-300">
                    <input
                      type="checkbox"
                      checked={trialChecked}
                      onChange={(event) => setTrialChecked(event.target.checked)}
                    />
                    I tried this entry and these three steps myself, and checked every
                    proposed product claim.
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-xs text-neutral-300">
                    <input
                      type="checkbox"
                      checked={rulesChecked}
                      onChange={(event) => setRulesChecked(event.target.checked)}
                    />
                    I checked the actual publishing venue rules; this manual invitation is
                    allowed. This is my report, not PostBeacon verification.
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="min-h-11"
                      disabled={!canConfirm}
                      onClick={() =>
                        onQueue(research.id, opportunity.id, rulesChecked, trialChecked)
                      }
                    >
                      Confirm trial into Today
                    </Button>
                    <Button
                      variant="ghost"
                      className="min-h-11"
                      disabled={
                        loading ||
                        stale ||
                        inputsChanged ||
                        issues.length > 0 ||
                        !rulesChecked ||
                        !trialChecked
                      }
                      onClick={() =>
                        void copy(`${opportunity.draft.hook}\n\n${opportunity.draft.body}`)
                      }
                    >
                      Copy reviewed invitation
                    </Button>
                  </div>
                  {copyStatus && (
                    <p role="status" className="text-xs text-accent-300">
                      {copyStatus}
                    </p>
                  )}
                  {confirmedPlan && (
                    <p role="status" className="text-sm text-accent-300">
                      Trial confirmed · {confirmedPlan.status}.{" "}
                      {confirmedPlan.status === "ready"
                        ? "Added to Today. Next: Review prepared draft in your queue, then publish manually."
                        : "The independent experiment remains in your project history."}
                    </p>
                  )}
                  {capacity && !confirmedPlan && (
                    <p role="alert" className="text-xs text-amber-300">
                      The project queue is at capacity. Export/archive this project or start
                      another before adding more tests.
                    </p>
                  )}
                </div>
              )}
              <Button
                variant="ghost"
                className="min-h-11"
                disabled={loading}
                onClick={() => {
                  onClear();
                  setSelected(undefined);
                  setCopyStatus("");
                }}
              >
                Discard trial kit — keep confirmed experiments
              </Button>
            </section>
          )}
        </div>
      )}
    </Card>
  );
}
