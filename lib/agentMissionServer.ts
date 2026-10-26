import type { SupabaseClient } from "@supabase/supabase-js";
import { asRecord } from "./coerce";
import { PublicError } from "./errors";
import { publicAgentRun } from "./agentRuns";
import { publicAgentMission, type AgentMissionCommand } from "./agentMissions";
import { opportunityResearchBodySchema, parseBody } from "./validate";
import {
  researchContextKey,
  productTrialEntry,
  trialProductFacts,
} from "./opportunityResearch";
import { containsPrivateResearchText } from "./autonomousResearch";
import type { AgentMission } from "./agentMissions";

export const agentMissionsEnabled = () =>
  process.env.AGENT_MISSIONS_ENABLED === "true" &&
  process.env.AGENT_RUNS_ENABLED === "true" &&
  Boolean(process.env.SEARCH_API_KEY?.trim()) &&
  Boolean(process.env.OPENAI_API_KEY?.trim());

export function missionStoreError(error: { message?: string } | null): void {
  if (!error) return;
  if (error.message?.includes("budget_exhausted"))
    throw new PublicError(
      "The shared daily Agent allowance is used up. Try after 00:00 UTC.",
      429
    );
  if (
    error.message?.includes("revision_conflict") ||
    error.message?.includes("context_conflict")
  )
    throw new PublicError(
      "The mission or saved product changed. Reload and explicitly authorize the current Brief again.",
      409
    );
  if (error.message?.includes("mission_paused"))
    throw new PublicError(
      "This daily mission is paused. Review and authorize it before running.",
      409
    );
  if (error.message?.includes("project_not_found"))
    throw new PublicError(
      "Save this project to your account before setting up daily research.",
      409
    );
  throw new PublicError(
    "Daily research storage is unavailable. Verify both Agent migrations before enabling it.",
    503
  );
}

export async function readAgentMission(
  sb: SupabaseClient,
  userId: string,
  projectId: string
) {
  const { data, error } = await sb
    .from("agent_missions")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error && ["42P01", "PGRST205"].includes(error.code)) {
    // A legacy install may have no mission table; a known later installation may
    // never hide authorized work behind a schema-cache error, even with flags off.
    const marker = await sb
      .from("entitlements")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (marker.error || asRecord(marker.data).mission_data_initialized === true)
      throw new PublicError(
        "Previously installed daily research could not be read. Contact the operator before assuming it is paused.",
        503
      );
    return null;
  }
  missionStoreError(error);
  if (!data) return null;
  const mission = publicAgentMission(data);
  if (!mission)
    throw new PublicError(
      "The saved mission could not be read safely. Pause it and review the setup.",
      503
    );
  return mission;
}

export async function savedMissionSnapshot(
  sb: SupabaseClient,
  userId: string,
  projectId: string,
  contextKey: string,
  input: AgentMission["settings"]["brief"]
) {
  const { data, error } = await sb
    .from("projects")
    .select("id,url,profile,meta,updated_at")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  missionStoreError(error);
  if (!data) throw new PublicError("Save this project to your account first.", 409);
  const project = asRecord(data),
    meta = asRecord(project.meta);
  const payload = parseBody(opportunityResearchBodySchema, {
    provider: "openai",
    input,
    productUrl: project.url,
    profile: project.profile,
    facts: meta.facts,
    successContract: asRecord(meta.workspace).successContract,
    bannedClaims: asRecord(meta.memory).bannedClaims ?? [],
  });
  if (
    researchContextKey(
      payload.profile,
      payload.facts,
      payload.successContract,
      payload.productUrl,
      payload.bannedClaims
    ) !== contextKey
  )
    throw new PublicError(
      "Your product facts or goal changed. Save, review and re-authorize the daily mission; the old authorization cannot be reused.",
      409
    );
  const productUrl = new URL(productTrialEntry(payload.productUrl)),
    entryUrl = new URL(payload.input.entryUrl);
  if (entryUrl.origin !== productUrl.origin)
    throw new PublicError("The trial entry must belong to your saved product origin.");
  if (
    entryUrl.search ||
    productUrl.search ||
    [
      payload.profile.name,
      input.audience,
      input.task,
      input.venue,
      input.feedbackQuestion,
      ...input.steps,
      ...trialProductFacts(payload.facts)
        .slice(0, 20)
        .map((fact) => fact.claim),
      ...(payload.bannedClaims ?? []),
    ].some(containsPrivateResearchText)
  )
    throw new PublicError(
      "Daily research needs public product descriptions and entry URLs without contact details, secrets or query parameters."
    );
  if (
    typeof project.updated_at !== "string" ||
    !Number.isFinite(Date.parse(project.updated_at))
  )
    throw new PublicError(
      "The saved project version could not be verified. Save your project before authorizing research.",
      409
    );
  return { payload, updatedAt: project.updated_at };
}

/** The version stamp is never part of prompts or persisted research payloads. */
export async function savedMissionPayload(
  sb: SupabaseClient,
  userId: string,
  projectId: string,
  contextKey: string,
  input: AgentMission["settings"]["brief"]
) {
  return (await savedMissionSnapshot(sb, userId, projectId, contextKey, input)).payload;
}

export async function saveAgentMission(
  sb: SupabaseClient,
  userId: string,
  command: Extract<AgentMissionCommand, { action: "save" }>
) {
  if (command.settings.enabled && !agentMissionsEnabled())
    throw new PublicError(
      "Daily research needs configured search and OpenAI services before it can be enabled.",
      503
    );
  if (
    command.settings.enabled &&
    (!command.consent.publicSearch || !command.consent.openaiProcessing)
  )
    throw new PublicError(
      "Explicitly approve public search and OpenAI processing before enabling daily research.",
      400
    );
  await savedMissionPayload(
    sb,
    userId,
    command.projectId,
    command.contextKey,
    command.settings.brief
  );
  const { data, error } = await sb.rpc("save_agent_mission", {
    p_user_id: userId,
    p_project_id: command.projectId,
    p_context_key: command.contextKey,
    p_settings: command.settings,
    p_expected_revision: command.expectedRevision,
  });
  missionStoreError(error);
  const mission = publicAgentMission(data);
  if (!mission)
    throw new PublicError("The mission did not return a valid saved receipt.", 503);
  return mission;
}

export async function pauseAgentMission(
  sb: SupabaseClient,
  userId: string,
  projectId: string
) {
  const { data, error } = await sb.rpc("pause_agent_mission", {
    p_user_id: userId,
    p_project_id: projectId,
  });
  missionStoreError(error);
  if (!data) return null;
  const mission = publicAgentMission(data);
  if (!mission)
    throw new PublicError(
      "The pause receipt could not be verified. Reload before starting more work.",
      503
    );
  return mission;
}

export async function reserveAgentMissionRun(
  sb: SupabaseClient,
  userId: string,
  mission: AgentMission,
  contextKey: string,
  expectedRevision = mission.revision
) {
  if (!agentMissionsEnabled())
    throw new PublicError(
      "Daily research is not enabled or its configured services are unavailable.",
      503
    );
  if (!mission.enabled) throw new PublicError("This daily mission is paused.", 409);
  if (Date.parse(mission.expiresAt) <= Date.now())
    throw new PublicError(
      "This daily authorization expired. Review and explicitly authorize another 30 days.",
      409
    );
  if (contextKey !== mission.contextKey || expectedRevision !== mission.revision)
    throw new PublicError(
      "The mission changed. Reload and review its current authorization.",
      409
    );
  const payload = await savedMissionPayload(
    sb,
    userId,
    mission.projectId,
    contextKey,
    mission.settings.brief
  );
  const { data, error } = await sb.rpc("reserve_agent_mission_run", {
    p_user_id: userId,
    p_mission_id: mission.id,
    p_context_key: contextKey,
    p_expected_revision: expectedRevision,
    p_payload: payload,
  });
  missionStoreError(error);
  const run = publicAgentRun(data);
  if (!run)
    throw new PublicError(
      "The reserved daily task receipt could not be read. It will not be repeated automatically.",
      503
    );
  return run;
}

/** A bounded request-backed dispatcher. It is not a guarantee of continuous execution. */
export async function reserveDueAgentMissions(sb: SupabaseClient, now = new Date()) {
  const utcStart = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const { data, error } = await sb
    .from("agent_missions")
    .select("*")
    .eq("enabled", true)
    .gt("expires_at", now.toISOString())
    .or(`last_run_at.is.null,last_run_at.lt.${utcStart}`)
    .order("last_dispatch_at", { ascending: true, nullsFirst: true })
    .limit(3);
  missionStoreError(error);
  const reserved: { id: string; userId: string }[] = [];
  let skipped = 0;
  for (const raw of data ?? []) {
    const mission = publicAgentMission(raw),
      row = asRecord(raw);
    if (!mission || typeof row.user_id !== "string") {
      skipped++;
      continue;
    }
    // Rotate even stale authorizations fairly without changing their context,
    // authorization expiry or the user's project activity/retention clock.
    const marked = await sb
      .from("agent_missions")
      .update({ last_dispatch_at: now.toISOString() })
      .eq("id", mission.id)
      .eq("user_id", row.user_id)
      .eq("revision", mission.revision);
    missionStoreError(marked.error);
    try {
      const run = await reserveAgentMissionRun(
        sb,
        row.user_id,
        mission,
        mission.contextKey
      );
      if (run.status === "queued") reserved.push({ id: run.id, userId: row.user_id });
    } catch (error) {
      if (!(error instanceof PublicError)) throw error;
      skipped++;
    }
  }
  return { reserved, skipped };
}
