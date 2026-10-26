import { asRecord, asString } from "./coerce";
import {
  normalizeOpportunityResearch,
  normalizeResearchInput,
} from "./opportunityResearch";
import type { OpportunityResearch, TrialResearchInput } from "./types";
import {
  normalizeAutonomousSearchReceipt,
  type AutonomousSearchReceipt,
} from "./autonomousResearch";

export const AGENT_PHASES = ["queued", "sources", "model", "ready"] as const;
export type AgentPhase = (typeof AGENT_PHASES)[number];
export type AgentRunStatus = "queued" | "running" | "ready" | "failed" | "cancelled";

/** Owner-visible projection. Worker lease and input fact snapshots never enter UI state. */
export interface AgentRun {
  id: string;
  projectId: string;
  status: AgentRunStatus;
  phase: AgentPhase;
  provider: "openai" | "deepseek";
  createdAt: string;
  updatedAt: string;
  interrupted: boolean;
  canResume: boolean;
  modelAttempted: boolean;
  sourceCount: number;
  checkedSources: number;
  failureMessage?: string;
  input: TrialResearchInput;
  research?: OpportunityResearch;
  autonomous?: boolean;
  missionId?: string;
  missionRevision?: number;
  searchAttempted?: boolean;
  searchReceipt?: AutonomousSearchReceipt;
}

export interface AgentRunList {
  enabled: boolean;
  runs: AgentRun[];
}

export function publicAgentRun(raw: unknown, now = Date.now()): AgentRun | undefined {
  const row = asRecord(raw),
    payload = asRecord(row.payload);
  const input = normalizeResearchInput(payload.input);
  const status = asString(row.status),
    phase = asString(row.phase);
  if (
    !input ||
    !asString(row.id) ||
    !asString(row.project_id) ||
    !["queued", "running", "ready", "failed", "cancelled"].includes(status) ||
    !AGENT_PHASES.includes(phase as AgentPhase) ||
    !["openai", "deepseek"].includes(asString(row.provider))
  )
    return undefined;
  const interrupted =
    (status === "running" && Date.parse(asString(row.lease_expires_at)) <= now) ||
    (["queued", "running"].includes(status) &&
      Date.parse(asString(row.deadline_at)) <= now);
  const autonomous = typeof row.mission_id === "string";
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    status: status as AgentRunStatus,
    phase: phase as AgentPhase,
    provider: row.provider as "openai" | "deepseek",
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    interrupted,
    canResume:
      (status === "queued" || interrupted) &&
      row.model_attempted !== true &&
      !(autonomous && row.search_attempted === true) &&
      Number(row.attempts) < 2 &&
      Date.parse(asString(row.deadline_at)) > now,
    modelAttempted: row.model_attempted === true,
    sourceCount: autonomous
      ? Array.isArray(row.sources)
        ? row.sources.length
        : 0
      : input.sources.length,
    checkedSources: Array.isArray(row.sources) ? row.sources.length : 0,
    failureMessage: asString(row.failure_message).slice(0, 400) || undefined,
    input,
    research: status === "ready" ? normalizeOpportunityResearch(row.research) : undefined,
    ...(autonomous
      ? {
          autonomous: true,
          missionId: asString(row.mission_id),
          missionRevision: Number(row.mission_revision),
          searchAttempted: row.search_attempted === true,
          searchReceipt: normalizeAutonomousSearchReceipt(row.search_receipt),
        }
      : {}),
  };
}

export function agentRunMessage(run: AgentRun): string {
  if (run.status === "cancelled")
    return "Cancelled. No result was applied. An already-sent provider request may still finish and incur cost.";
  if (run.status === "failed")
    return `${run.failureMessage ?? "Research stopped."} Your plan is unchanged. A new task requires an explicit request and reservation.`;
  if (run.autonomous && run.interrupted && run.searchAttempted)
    return "Daily research stopped after its one search attempt was reserved. Search and model work will not be repeated automatically; review the saved receipt.";
  if (run.interrupted && run.modelAttempted)
    return "Execution was interrupted after the model request was reserved. Its outcome is unknown; it will not be automatically repeated.";
  if (run.interrupted)
    return run.canResume
      ? run.autonomous
        ? "Execution was interrupted before public search was reserved. You can explicitly resume the approved public research."
        : run.input.mode === "product-led"
          ? "Execution was interrupted before the model request. You can resume the input checks safely."
          : "Execution was interrupted before the model request. You can resume the source checks safely."
      : "Recovery deadline or attempt limit reached. This task will not restart; review its receipts and explicitly prepare a new task.";
  if (run.status === "ready")
    if (run.autonomous && !run.research)
      return "Daily research completed without usable verified sources. No invitation was invented or queued. This is not evidence of no demand.";
  if (run.status === "ready")
    return run.research?.opportunities.length
      ? "Research is ready for your review. Nothing has been queued or published."
      : "No usable invitation was returned. This is not evidence that your product has no demand.";
  if (run.phase === "model")
    return "The one model request has been reserved; preparing tentative invitations. No retry or fallback.";
  if (run.phase === "sources")
    if (run.autonomous)
      return "Researching only your approved public queries and exact domains. Search matches still need source verification and your review; no posting permission is implied.";
  if (run.phase === "sources")
    return run.input.mode === "product-led"
      ? "Using verified product facts only. No external demand sources are being fetched or verified."
      : "Checking only the public sources you explicitly allowed. Excerpts without fetching remain user-provided.";
  return "Task saved. Waiting for a worker to claim it; no progress is inferred from elapsed time.";
}
