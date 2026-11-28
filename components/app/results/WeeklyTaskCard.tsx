"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import {
  WEEKLY_TASK_KIND_LABEL,
  WEEKLY_TASK_STATUS_LABEL,
  renderBuildBrief,
  weeklyTaskIntakeDefaults,
} from "@/lib/weeklyTask";
import type { WeeklyTaskController } from "@/hooks/useWeeklyTask";
import type {
  Fact,
  WeeklyTask,
  WeeklyTaskKind,
  WeeklyTaskProposal,
  WeeklyTaskScenarioResult,
  WeeklyTaskStatus,
  WorkspaceState,
} from "@/lib/types";

const STEPS: WeeklyTaskStatus[] = ["planning", "proposed", "building", "verifying"];
const KINDS = Object.keys(WEEKLY_TASK_KIND_LABEL) as WeeklyTaskKind[];
const now = () => new Date().toISOString();
const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

function StatusSteps({ status }: { status: WeeklyTaskStatus }) {
  const index = status === "verified" ? STEPS.length : STEPS.indexOf(status);
  return (
    <ol className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" aria-label="Task progress">
      {STEPS.map((step, i) => (
        <li
          key={step}
          aria-current={i === index ? "step" : undefined}
          className={
            i === index
              ? "font-semibold text-accent-300"
              : i < index
                ? "text-emerald-300/80"
                : "text-neutral-600"
          }
        >
          {i < index ? "✓" : `${i + 1}.`} {WEEKLY_TASK_STATUS_LABEL[step]}
        </li>
      ))}
      {status === "verified" && (
        <li aria-current="step" className="font-semibold text-emerald-300">
          ✓ {WEEKLY_TASK_STATUS_LABEL.verified}
        </li>
      )}
    </ol>
  );
}

function List({ title, items, tone }: { title: string; items: string[]; tone?: "warn" }) {
  if (!items.length) return null;
  return (
    <div>
      <h4
        className={`text-xs font-semibold uppercase tracking-wide ${
          tone === "warn" ? "text-amber-300" : "text-neutral-400"
        }`}
      >
        {title}
      </h4>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-neutral-200">
        {items.map((item) => (
          <li key={item} className="break-words">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProposalView({ task, facts }: { task: WeeklyTask; facts: Fact[] }) {
  const proposal = task.proposal!;
  const cited =
    task.confirmedFacts?.map((fact) => fact.claim) ??
    proposal.factIds.flatMap((id) => {
      const fact = facts.find((item) => item.id === id);
      return fact ? [fact.claim] : [];
    });
  const source =
    task.proposalSource === "example"
      ? "Fictional example written by code — no model call."
      : task.proposalSource === "founder"
        ? "Written by you."
        : `Proposed by ${task.meta?.provider ?? "the model"}${
            task.meta?.model ? ` (${task.meta.model})` : ""
          }${task.founderEdited ? ", edited by you" : ""}. It did not read your repository.`;
  return (
    <div className="space-y-4">
      <div>
        <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-300">
          {WEEKLY_TASK_KIND_LABEL[proposal.kind]}
        </span>
        <h4 className="mt-2 break-words text-lg font-semibold text-neutral-100">
          {proposal.title}
        </h4>
        <p className="mt-1 break-words text-sm text-neutral-300">{proposal.rationale}</p>
        <p className="mt-1 text-xs text-neutral-500">{source}</p>
      </div>
      {cited.length ? (
        <List title="Based on your verified facts" items={cited} />
      ) : (
        <p className="text-xs text-amber-300">
          No verified product fact is cited. Treat the reasoning as an untested hypothesis.
        </p>
      )}
      <List title="Smallest scope" items={proposal.minimalScope} />
      <List title="Acceptance scenarios" items={proposal.acceptance} />
      <List title="Test requirements" items={proposal.tests} />
      <List title="Assumptions" items={proposal.assumptions} />
      <List title="Not doing" items={proposal.nonGoals} />
      <List
        title="Unknown — not established by evidence"
        items={proposal.unknowns}
        tone="warn"
      />
    </div>
  );
}

type ProposalDraft = {
  kind: WeeklyTaskKind;
  title: string;
  rationale: string;
  minimalScope: string;
  acceptance: string;
  tests: string;
  assumptions: string;
  nonGoals: string;
  unknowns: string;
};
const draftFrom = (proposal?: WeeklyTaskProposal): ProposalDraft => ({
  kind: proposal?.kind ?? "product-improvement",
  title: proposal?.title ?? "",
  rationale: proposal?.rationale ?? "",
  minimalScope: proposal?.minimalScope.join("\n") ?? "",
  acceptance: proposal?.acceptance.join("\n") ?? "",
  tests: proposal?.tests.join("\n") ?? "",
  assumptions: proposal?.assumptions.join("\n") ?? "",
  nonGoals: proposal?.nonGoals.join("\n") ?? "",
  unknowns: proposal?.unknowns.join("\n") ?? "",
});

function ProposalEditor({
  initial,
  factIds,
  onSave,
  onCancel,
}: {
  initial?: WeeklyTaskProposal;
  factIds: string[];
  onSave: (proposal: unknown) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => draftFrom(initial));
  const set = (key: keyof ProposalDraft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="weekly-task-kind"
          className="mb-1 block text-xs font-medium text-neutral-400"
        >
          Task type
        </label>
        <select
          id="weekly-task-kind"
          value={draft.kind}
          onChange={(event) => set("kind")(event.target.value)}
          className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
        >
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {WEEKLY_TASK_KIND_LABEL[kind]}
            </option>
          ))}
        </select>
      </div>
      <Field label="Task title" value={draft.title} onChange={set("title")} />
      <Field
        label="Why this task"
        value={draft.rationale}
        onChange={set("rationale")}
        textarea
      />
      <Field
        label="Smallest scope (one per line)"
        value={draft.minimalScope}
        onChange={set("minimalScope")}
        textarea
      />
      <Field
        label="Acceptance scenarios (one per line)"
        value={draft.acceptance}
        onChange={set("acceptance")}
        textarea
      />
      <Field
        label="Test requirements (one per line)"
        value={draft.tests}
        onChange={set("tests")}
        textarea
      />
      <Field
        label="Assumptions (one per line)"
        value={draft.assumptions}
        onChange={set("assumptions")}
        textarea
      />
      <Field
        label="Not doing (one per line)"
        value={draft.nonGoals}
        onChange={set("nonGoals")}
        textarea
      />
      <Field
        label="Unknowns (one per line)"
        value={draft.unknowns}
        onChange={set("unknowns")}
        textarea
      />
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() =>
            onSave({
              kind: draft.kind,
              title: draft.title,
              rationale: draft.rationale,
              factIds,
              minimalScope: lines(draft.minimalScope),
              acceptance: lines(draft.acceptance),
              tests: lines(draft.tests),
              assumptions: lines(draft.assumptions),
              nonGoals: lines(draft.nonGoals),
              unknowns: lines(draft.unknowns),
            })
          }
        >
          Save task for review
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function BriefPanel({
  task,
  productName,
  productUrl,
  facts,
}: {
  task: WeeklyTask;
  productName: string;
  productUrl: string;
  facts: Fact[];
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "manual">("idle");
  const brief = renderBuildBrief(task, { name: productName, url: productUrl }, facts);
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(brief);
      setCopied("copied");
    } catch {
      setCopied("manual"); // never claim a copy that did not happen
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void copy()}>Copy Build Brief</Button>
        <span className="text-xs text-neutral-500" role="status">
          {copied === "copied"
            ? "Copied. Paste it into Codex, Claude Code or Cursor."
            : copied === "manual"
              ? "Copy was blocked by the browser — select the text below and copy it manually."
              : "For Codex, Claude Code or Cursor. PostBeacon did not read your repository."}
        </span>
      </div>
      <details open={copied === "manual"} className="rounded-lg border border-line">
        <summary className="cursor-pointer px-3 py-2 text-xs text-neutral-400">
          Preview the Build Brief
        </summary>
        <pre
          data-testid="build-brief"
          className="max-h-96 overflow-auto whitespace-pre-wrap break-words border-t border-line px-3 py-2 text-xs leading-relaxed text-neutral-300"
        >
          {brief}
        </pre>
      </details>
    </div>
  );
}

const RESULT_LABEL: Record<WeeklyTaskScenarioResult, string> = {
  passed: "Passed",
  failed: "Failed",
  "not-checked": "Not checked",
};

function EvidenceForm({
  task,
  onSubmit,
}: {
  task: WeeklyTask;
  onSubmit: (evidence: unknown) => void;
}) {
  const scenarios = task.proposal!.acceptance;
  const [results, setResults] = useState<WeeklyTaskScenarioResult[]>(() =>
    scenarios.map(() => "not-checked")
  );
  const [changeSummary, setChangeSummary] = useState("");
  const [proof, setProof] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-300">
        A plan is not proof. Record what you actually changed and what you saw when you
        checked each scenario.
      </p>
      {scenarios.map((scenario, index) => (
        <fieldset key={scenario} className="rounded-lg border border-line px-3 py-2">
          <legend className="break-words px-1 text-sm text-neutral-200">
            {index + 1}. {scenario}
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {(Object.keys(RESULT_LABEL) as WeeklyTaskScenarioResult[]).map((value) => (
              <label
                key={value}
                className="flex items-center gap-1.5 text-xs text-neutral-300"
              >
                <input
                  type="radio"
                  name={`weekly-scenario-${index}`}
                  checked={results[index] === value}
                  onChange={() =>
                    setResults((current) =>
                      current.map((item, i) => (i === index ? value : item))
                    )
                  }
                />
                {RESULT_LABEL[value]}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <Field
        label="What changed (your words)"
        value={changeSummary}
        onChange={setChangeSummary}
        textarea
        placeholder="e.g. Added a sample project to the empty first-run screen and shipped it on Tuesday."
      />
      <Field
        label="What you observed when checking"
        value={proof}
        onChange={setProof}
        textarea
        placeholder="e.g. Opened the live site signed out, the sample loaded, two testers finished the first task."
      />
      <Field
        label="Link to evidence (optional, not checked by PostBeacon)"
        value={proofUrl}
        onChange={setProofUrl}
        placeholder="https://"
      />
      <Button onClick={() => onSubmit({ changeSummary, proof, proofUrl, results })}>
        Submit evidence
      </Button>
    </div>
  );
}

/**
 * M27.1 — the one weekly task on Today. Presentational: every state change is
 * a command sent through the controller, and the reducer decides.
 */
export function WeeklyTaskCard({
  controller,
  workspace,
  facts,
  productName,
  productUrl,
  demo,
}: {
  controller: WeeklyTaskController;
  workspace: WorkspaceState;
  facts: Fact[];
  productName: string;
  productUrl: string;
  demo: boolean;
}) {
  const { task, history, planning, message, send } = controller;
  const defaults = weeklyTaskIntakeDefaults(workspace);
  const [pain, setPain] = useState(task?.intake.pain ?? "");
  const [successSignal, setSuccessSignal] = useState(
    task?.intake.successSignal ?? defaults.successSignal
  );
  const [hours, setHours] = useState(
    task ? String(task.intake.hoursAvailable) : defaults.hoursAvailable
  );
  const [mode, setMode] = useState<"view" | "intake" | "write" | "edit">("view");
  const [note, setNote] = useState("");
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  const contextChanged =
    task?.status === "proposed" && task.contextKey !== controller.context.contextKey;
  const abandon = task && task.status !== "verified" && (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        if (!confirmAbandon) return setConfirmAbandon(true);
        setConfirmAbandon(false);
        setMode("view");
        send({ type: "abandoned", taskId: task.id, at: now() });
      }}
    >
      {confirmAbandon ? "Confirm: abandon this task" : "Abandon task"}
    </Button>
  );

  const saveIntake = () => {
    const refusal = send({
      type: "intake-saved",
      id: task?.id ?? crypto.randomUUID(),
      revision: task?.revision,
      intake: { pain, successSignal, hoursAvailable: Number(hours) },
      at: now(),
    });
    if (!refusal) setMode("view");
  };

  const intakeForm = (
    <div className="space-y-3">
      <p className="text-sm text-neutral-300">
        One task, one week. Three inputs — your goal and product facts are reused from this
        project.
      </p>
      <Field
        label="Which user pain should this week address?"
        value={pain}
        onChange={setPain}
        textarea
        placeholder="In your own words: where do people get stuck, or what do they ask for?"
      />
      <Field
        label={
          defaults.successSignal
            ? "What result would count as success? (prefilled from your goal)"
            : "What result would count as success?"
        }
        value={successSignal}
        onChange={setSuccessSignal}
        textarea
      />
      <Field
        label="Hours you can really spend this week"
        value={hours}
        onChange={setHours}
        placeholder="e.g. 4"
      />
      <div className="flex flex-wrap gap-2">
        <Button onClick={saveIntake}>Save inputs</Button>
        {task && (
          <Button variant="ghost" onClick={() => setMode("view")}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <section aria-label="This week's task">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-accent-300">
              This week&apos;s task
            </p>
            <h3 className="mt-1 text-xl font-semibold text-neutral-100">
              {task
                ? WEEKLY_TASK_STATUS_LABEL[task.status]
                : "Pick one thing worth doing this week"}
            </h3>
          </div>
          {demo && (
            <span className="rounded-full border border-amber-700/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
              Fictional example · no model call · not saved
            </span>
          )}
        </div>
        {task && (
          <div className="mt-3">
            <StatusSteps status={task.status} />
          </div>
        )}
        <div className="mt-4 space-y-4">
          {(!task || mode === "intake") && intakeForm}

          {task?.status === "planning" && mode === "view" && (
            <>
              <dl className="space-y-1 text-sm">
                <div>
                  <dt className="text-xs text-neutral-500">User pain</dt>
                  <dd className="break-words text-neutral-200">{task.intake.pain}</dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-500">Success signal</dt>
                  <dd className="break-words text-neutral-200">
                    {task.intake.successSignal}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-500">Time</dt>
                  <dd className="text-neutral-200">
                    {task.intake.hoursAvailable} h this week
                  </dd>
                </div>
              </dl>
              {planning ? (
                <div className="flex flex-wrap items-center gap-3" role="status">
                  <Spinner />
                  <span className="text-sm text-neutral-300">
                    Asking for one proposal from your verified facts…
                  </span>
                  <Button variant="outline" size="sm" onClick={controller.cancelPlanning}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!controller.canAskAgent}
                    onClick={() => void controller.plan()}
                  >
                    {demo ? "Show a fictional proposal" : "Ask the Agent for one proposal"}
                  </Button>
                  <Button variant="outline" onClick={() => setMode("write")}>
                    Write it myself
                  </Button>
                  <Button variant="ghost" onClick={() => setMode("intake")}>
                    Edit inputs
                  </Button>
                </div>
              )}
              {!controller.canAskAgent && !planning && (
                <p className="text-xs text-neutral-500">
                  Agent proposals need a signed-in account with OpenAI configured. Writing
                  the task yourself works without either and uses no model.
                </p>
              )}
            </>
          )}

          {task?.status === "planning" && mode === "write" && (
            <ProposalEditor
              factIds={[]}
              onCancel={() => setMode("view")}
              onSave={(proposal) => {
                const refusal = send({
                  type: "proposal-received",
                  taskId: task.id,
                  revision: task.revision,
                  contextKey: controller.context.contextKey,
                  proposal,
                  source: "founder",
                  at: now(),
                });
                if (!refusal) setMode("view");
              }}
            />
          )}

          {task?.status === "proposed" && mode === "edit" && (
            <ProposalEditor
              initial={task.proposal}
              factIds={task.proposal?.factIds ?? []}
              onCancel={() => setMode("view")}
              onSave={(proposal) => {
                const refusal = send({
                  type: "proposal-edited",
                  taskId: task.id,
                  revision: task.revision,
                  proposal,
                  at: now(),
                });
                if (!refusal) setMode("view");
              }}
            />
          )}

          {task?.status === "proposed" && mode === "view" && (
            <>
              <ProposalView task={task} facts={facts} />
              {contextChanged && (
                <p role="alert" className="text-sm text-amber-300">
                  Your product facts or goal changed after this proposal was written. Plan
                  again before confirming.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={contextChanged}
                  onClick={() =>
                    send({
                      type: "confirmed",
                      taskId: task.id,
                      revision: task.revision,
                      at: now(),
                    })
                  }
                >
                  Confirm this task
                </Button>
                <Button variant="outline" onClick={() => setMode("edit")}>
                  Edit
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    send({
                      type: "replan-requested",
                      taskId: task.id,
                      revision: task.revision,
                      at: now(),
                    })
                  }
                >
                  Plan again
                </Button>
              </div>
            </>
          )}

          {task && (task.status === "building" || task.status === "verifying") && (
            <>
              <ProposalView task={task} facts={facts} />
              <BriefPanel
                task={task}
                productName={productName}
                productUrl={productUrl}
                facts={facts}
              />
            </>
          )}

          {task?.status === "building" && (
            <>
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Progress notes (your own log — not evidence)
                </h4>
                {task.progress.length > 0 && (
                  <ul className="space-y-1 text-sm text-neutral-300">
                    {task.progress.map((entry) => (
                      <li key={entry.at} className="break-words">
                        <span className="text-xs text-neutral-500">
                          {new Date(entry.at).toLocaleDateString()} ·{" "}
                        </span>
                        {entry.note}
                      </li>
                    ))}
                  </ul>
                )}
                <Field label="Add a progress note" value={note} onChange={setNote} />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const refusal = send({
                      type: "progress-noted",
                      taskId: task.id,
                      revision: task.revision,
                      note,
                      at: now(),
                    });
                    if (!refusal) setNote("");
                  }}
                >
                  Save note
                </Button>
              </div>
              <Button
                onClick={() =>
                  send({
                    type: "ready-to-verify",
                    taskId: task.id,
                    revision: task.revision,
                    at: now(),
                  })
                }
              >
                Development done — verify it
              </Button>
            </>
          )}

          {task?.status === "verifying" && (
            <>
              <EvidenceForm
                task={task}
                onSubmit={(evidence) =>
                  send({
                    type: "evidence-submitted",
                    taskId: task.id,
                    revision: task.revision,
                    evidence,
                    at: now(),
                  })
                }
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  send({
                    type: "reopened",
                    taskId: task.id,
                    revision: task.revision,
                    at: now(),
                  })
                }
              >
                Not done yet — back to development
              </Button>
            </>
          )}

          {task?.status === "verified" && task.evidence && (
            <>
              <div className="rounded-lg border border-emerald-800 bg-emerald-950/30 px-3 py-3">
                <p className="break-words text-sm font-semibold text-emerald-200">
                  ✓ {task.proposal?.title}
                </p>
                <p className="mt-1 text-xs text-emerald-300/80">
                  Verified by you on{" "}
                  {new Date(task.evidence.submittedAt).toLocaleDateString()}. PostBeacon did
                  not inspect your product or repository — this records your evidence.
                </p>
              </div>
              <List title="What changed" items={[task.evidence.changeSummary]} />
              <List title="What you observed" items={[task.evidence.proof]} />
              {task.evidence.proofUrl && (
                <p className="break-all text-xs text-neutral-400">
                  Evidence link (not checked): {task.evidence.proofUrl}
                </p>
              )}
              <Button onClick={() => send({ type: "closed", taskId: task.id, at: now() })}>
                Close and plan next week&apos;s task
              </Button>
            </>
          )}

          {/* Next to the action buttons, where a refused command was just clicked. */}
          {message && (
            <div
              role="alert"
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-amber-800 bg-amber-950/30 px-3 py-2 text-sm text-amber-200"
            >
              <span className="break-words">{message}</span>
              <button
                type="button"
                className="text-xs text-amber-300/70 hover:text-amber-200"
                onClick={controller.dismissMessage}
              >
                Dismiss
              </button>
            </div>
          )}

          {abandon && mode === "view" && <div>{abandon}</div>}

          {history.length > 0 && (
            <details className="text-xs text-neutral-500">
              <summary className="cursor-pointer">Earlier tasks ({history.length})</summary>
              <ul className="mt-1 space-y-1">
                {[...history].reverse().map((record) => (
                  <li key={record.id} className="break-words">
                    {record.outcome === "verified" ? "✓ Verified by you" : "Abandoned"} ·{" "}
                    {new Date(record.endedAt).toLocaleDateString()} · {record.title}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Card>
    </section>
  );
}
