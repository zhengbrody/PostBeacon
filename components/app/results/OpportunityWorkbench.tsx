"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { PLATFORMS } from "@/lib/platforms";
import {
  normalizeResearchInput,
  productTrialEntry,
  researchContextKey,
  trialSafety,
} from "@/lib/opportunityResearch";
import { isSafeExternalHref } from "@/lib/urlPolicy";
import { PROVIDER_PRIVACY } from "@/lib/privacy";
import { AgentRunPanel } from "./AgentRunPanel";
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
  const [open, setOpen] = useState(Boolean(research));
  const [input, setInput] = useState<TrialResearchInput>(
    () =>
      research?.input ?? {
        audience: profile.audience,
        task: "",
        entryUrl: (() => {
          try {
            return productTrialEntry(productUrl);
          } catch {
            return "";
          }
        })(),
        platformId: "twitter",
        venue: "Own X profile",
        steps: ["", "", ""],
        feedbackQuestion: "Which step was hardest to understand?",
        sources: [{ url: "", quote: "", fetchAllowed: false }],
      }
  );
  const [selected, setSelected] = useState<string>();
  const [rulesChecked, setRulesChecked] = useState(false);
  const [trialChecked, setTrialChecked] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [deepseekConsent, setDeepseekConsent] = useState(false);
  const opportunity = research?.opportunities.find((o) => o.id === selected);
  const source = research?.sources.find((s) => s.id === opportunity?.sourceId);
  const stale = Boolean(
    research &&
    research.contextKey !==
      researchContextKey(profile, facts, contract, productUrl, bannedClaims)
  );
  const inputsChanged = Boolean(
    research &&
    !demo &&
    JSON.stringify(normalizeResearchInput(input)) !== JSON.stringify(research.input)
  );
  const issues =
    research && opportunity
      ? trialSafety(research, opportunity.id, facts, profile, bannedClaims)
      : [];
  const confirmedPlan = queue.find((plan) => plan.id === selected);
  const capacity =
    queue.length >= 40 ||
    Boolean(research && (draftCounts[research.input.platformId] ?? 0) >= 12);
  const canConfirm =
    !loading &&
    !stale &&
    !inputsChanged &&
    !issues.length &&
    rulesChecked &&
    trialChecked &&
    !confirmedPlan &&
    !capacity;
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus("Copied. Publish manually; this did not post anything.");
    } catch {
      setCopyStatus("Clipboard unavailable. Select the visible text and copy it manually.");
    }
  };
  const update = (patch: Partial<TrialResearchInput>) => {
    setDeepseekConsent(false);
    setInput((current) => ({ ...current, ...patch }));
  };

  return (
    <Card className="p-5 sm:p-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent-300">
        Growth Agent · bounded research
      </p>
      <h3 className="text-xl font-semibold">Find people to try one real task</h3>
      <p className="mt-2 text-sm text-neutral-400">
        Bring a public demand excerpt. Run one source-backed research task, review its
        evidence, then confirm an invitation into Today. No automatic outreach.
      </p>
      {!demo && (
        <AgentRunPanel
          agent={agent}
          onReview={(id) => {
            const run = agent.runs.find((item) => item.id === id);
            if (run) setInput(run.input);
            setSelected(undefined);
            setRulesChecked(false);
            setTrialChecked(false);
            setOpen(true);
            onReviewAgent(id);
          }}
        />
      )}
      <Button className="mt-4 min-h-11" variant="ghost" onClick={() => setOpen(!open)}>
        {open
          ? "Hide task preparation"
          : demo
            ? "Try example research"
            : "Prepare research task"}
      </Button>
      {open && (
        <div className="mt-5 space-y-5">
          <p className="text-xs text-neutral-500">
            {demo
              ? "Fictional example — never saved; no source fetching or model calls."
              : `At most 3 explicit sources and 1 model request (20s timeout, no automatic retry/fallback). Excerpts, verified product facts and trial instructions go to ${PROVIDER_PRIVACY[provider].label}. ${PROVIDER_PRIVACY[provider].note}`}{" "}
            No private messages, handles, emails or confidential data. No whole-site
            crawling, automatic posting or outreach.
          </p>
          {!demo && (
            <p className="text-xs text-neutral-400">
              One reservation per task; at most 10 tasks per account and 100 shared tasks
              per UTC day. Maximum 1 model request and 2,600 output tokens per task.
              Reservations are not refunded for cancellation or failure. These are request
              limits, not exact dollar budgets.
            </p>
          )}
          {!demo && (
            <div className="space-y-4">
              <Field
                label="Who should try this?"
                value={input.audience}
                onChange={(audience) => update({ audience })}
              />
              <Field
                label="One task to try"
                value={input.task}
                onChange={(task) => update({ task })}
                placeholder="e.g. Compare a sample portfolio under one crash scenario"
              />
              <Field
                label="Real product trial entry"
                value={input.entryUrl}
                onChange={(entryUrl) => update({ entryUrl })}
              />
              <label className="block text-xs text-neutral-400">
                Publishing channel
                <select
                  aria-label="Trial publishing channel"
                  className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface-2 p-2 text-sm"
                  value={input.platformId}
                  onChange={(e) => update({ platformId: e.target.value })}
                >
                  {PLATFORMS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label="Publishing venue — separate from evidence sources"
                value={input.venue}
                onChange={(venue) => update({ venue })}
                placeholder="e.g. own X profile, or the exact community"
              />
              <p className="text-xs text-neutral-500">
                Write steps you can actually perform in your current product. These are your
                proposed instructions, not server-verified functionality.
              </p>
              {input.steps.map((step, index) => (
                <Field
                  key={index}
                  label={`Trial step ${index + 1}`}
                  value={step}
                  onChange={(value) => {
                    const steps: [string, string, string] = [...input.steps];
                    steps[index] = value;
                    update({ steps });
                  }}
                />
              ))}
              <Field
                label="One feedback question"
                value={input.feedbackQuestion}
                onChange={(feedbackQuestion) => update({ feedbackQuestion })}
              />
              {input.sources.map((sourceInput, index) => (
                <div key={index} className="space-y-3 rounded-lg border border-line p-3">
                  <Field
                    label={`Demand source ${index + 1} URL`}
                    value={sourceInput.url}
                    onChange={(url) =>
                      update({
                        sources: input.sources.map((s, i) =>
                          i === index ? { ...s, url } : s
                        ),
                      })
                    }
                  />
                  <Field
                    label={`Demand excerpt ${index + 1} — 30–400 characters`}
                    textarea
                    value={sourceInput.quote}
                    onChange={(quote) =>
                      update({
                        sources: input.sources.map((s, i) =>
                          i === index ? { ...s, quote } : s
                        ),
                      })
                    }
                  />
                  <label className="flex min-h-11 items-center gap-2 text-xs text-neutral-400">
                    <input
                      type="checkbox"
                      checked={sourceInput.fetchAllowed}
                      onChange={(e) =>
                        update({
                          sources: input.sources.map((s, i) =>
                            i === index ? { ...s, fetchAllowed: e.target.checked } : s
                          ),
                        })
                      }
                    />
                    I have permission for this public page to be fetched. Check only this
                    URL.
                  </label>
                  <p className="text-xs text-neutral-500">
                    Default: excerpt only, no page request. X, Reddit and other restricted
                    social sites require separately reviewed connectors; leave fetching
                    unchecked.
                  </p>
                  {input.sources.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11"
                      onClick={() =>
                        update({ sources: input.sources.filter((_, i) => i !== index) })
                      }
                    >
                      Remove source {index + 1}
                    </Button>
                  )}
                </div>
              ))}
              {input.sources.length < 3 && (
                <Button
                  variant="ghost"
                  className="min-h-11"
                  onClick={() =>
                    update({
                      sources: [
                        ...input.sources,
                        { url: "", quote: "", fetchAllowed: false },
                      ],
                    })
                  }
                >
                  Add another source
                </Button>
              )}
            </div>
          )}
          {!demo && provider === "deepseek" && (
            <label className="flex items-start gap-2 text-sm text-amber-300">
              <input
                type="checkbox"
                checked={deepseekConsent}
                onChange={(e) => setDeepseekConsent(e.target.checked)}
              />
              I agree to send these public excerpts and product facts to DeepSeek, which
              processes data in China. No confidential information.
            </label>
          )}
          <Button
            className="min-h-11"
            disabled={
              loading ||
              agent.busy ||
              (!demo &&
                (!agent.enabled ||
                  provider === "claude" ||
                  !normalizeResearchInput(input) ||
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
              ? "Research in progress…"
              : demo
                ? "Load fictional trial opportunity"
                : "Start one research task"}
          </Button>
          {!demo && provider === "claude" && (
            <p role="status" className="text-sm text-amber-300">
              Choose OpenAI or DeepSeek in the model picker. Claude is not enabled for trial
              research.
            </p>
          )}
          {research && (
            <>
              <p className="text-xs text-neutral-400">
                {research.example
                  ? "Example data — no model call."
                  : research.meta
                    ? `Actual provider: ${research.meta.provider} / ${research.meta.model}.`
                    : "No model call: none of the submitted excerpts could be used."}{" "}
                Quotes are not proof of current demand, dates or venue permission.
              </p>
              {inputsChanged && (
                <p role="status" className="text-sm text-amber-300">
                  Your form edits have not been applied to these results. Run research again
                  before confirming or copying a trial kit.
                </p>
              )}
              {stale && (
                <p role="alert" className="text-sm text-amber-300">
                  Product evidence or success definition changed. Research again before
                  confirming this kit.
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
                  {research.opportunities
                    .filter((o) => o.sourceId === item.id)
                    .map((candidate) => (
                      <div key={candidate.id} className="mt-3">
                        <p className="text-xs text-neutral-400">
                          Fit hypothesis, not an observed conclusion: {candidate.whyFit}
                        </p>
                        <p className="mt-1 text-xs text-neutral-500">
                          Product fact references: {candidate.factIds.join(", ") || "none"}
                        </p>
                        <Button
                          variant="ghost"
                          className="mt-3 min-h-11"
                          disabled={loading || stale || inputsChanged}
                          onClick={() => {
                            setSelected(candidate.id);
                            setRulesChecked(false);
                            setTrialChecked(false);
                            setCopyStatus("");
                          }}
                        >
                          Review this trial kit
                        </Button>
                      </div>
                    ))}
                </div>
              ))}
              {!research.opportunities.length && (
                <p role="status" className="text-sm text-neutral-400">
                  No grounded fit was returned. Keep the existing plan, change the sources
                  or retry explicitly. No opportunity was invented.
                </p>
              )}
              {opportunity && source && (
                <div className="space-y-4 rounded-xl border border-accent-500/40 p-4">
                  <h4 className="font-semibold">Trial kit · {research.input.task}</h4>
                  <p className="text-xs text-neutral-400">
                    Audience: {research.input.audience}
                    <br />
                    Publishing venue: {research.input.venue}
                  </p>
                  <ol className="ml-5 list-decimal space-y-2 text-sm">
                    {research.input.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
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
                    Feedback question: {research.input.feedbackQuestion}
                  </p>
                  <details className="text-xs text-neutral-400">
                    <summary className="cursor-pointer py-3">
                      Three real screenshot jobs — not generated attachments
                    </summary>
                    <ol className="ml-5 list-decimal space-y-3">
                      {research.input.steps.map((step, i) => (
                        <li key={i}>
                          Capture step {i + 1}: {step}. Show the relevant control or result,
                          not the whole dashboard.
                          <br />
                          Suggested alt text, edit after capture: “{research.input.task},
                          step {i + 1}.”
                        </li>
                      ))}
                    </ol>
                    <p className="mt-3">
                      Use actual product screens. Hide accounts, holdings, tokens and
                      third-party identities. Do not label sample results as real customer
                      outcomes.
                    </p>
                  </details>
                  <div className="whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 text-sm">
                    {opportunity.draft.hook}
                    {"\n\n"}
                    {opportunity.draft.body}
                  </div>
                  {issues.length > 0 && (
                    <div role="alert" className="text-sm text-amber-300">
                      Blocked by the current draft gate: {issues.join("; ")}. Confirm facts
                      or change the trial context and research again; nothing is queued.
                    </div>
                  )}
                  <label className="flex min-h-11 items-center gap-2 text-xs text-neutral-300">
                    <input
                      type="checkbox"
                      checked={trialChecked}
                      onChange={(e) => setTrialChecked(e.target.checked)}
                    />
                    I tried this entry and these three steps myself, and checked every
                    proposed product claim.
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-xs text-neutral-300">
                    <input
                      type="checkbox"
                      checked={rulesChecked}
                      onChange={(e) => setRulesChecked(e.target.checked)}
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
                        ? "Use Review prepared draft in your queue to publish manually."
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
                Discard research output — keep confirmed experiments
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
