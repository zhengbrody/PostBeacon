import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { asRecord, asString } from "./coerce";
import { PublicError } from "./errors";
import { publicAgentRun } from "./agentRuns";
import { runOpportunityResearch } from "./opportunityResearchServer";
import { normalizeResearchInput, researchContextKey } from "./opportunityResearch";
import { opportunityResearchBodySchema, parseBody } from "./validate";
import { trialResearchInputSchema } from "./opportunityResearch";
import { runAutonomousResearch } from "./autonomousResearchServer";
import {
  agentMissionsEnabled,
  missionStoreError,
  readAgentMission,
  savedMissionSnapshot,
} from "./agentMissionServer";

export const agentCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      projectId: z.uuid(),
      requestId: z.uuid(),
      provider: z.enum(["openai", "deepseek"]),
      input: trialResearchInputSchema,
      contextKey: z.string().min(1).max(50000),
      deepseekConsent: z.boolean(),
    })
    .strict(),
  z.object({ action: z.enum(["resume", "cancel"]), runId: z.uuid() }).strict(),
]);

function storeError(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (error.message?.includes("budget_exhausted"))
    throw new PublicError(
      "The daily Agent task allowance is used up. Try again after 00:00 UTC.",
      429
    );
  if (error.message?.includes("request_conflict"))
    throw new PublicError(
      "This request ID belongs to a different task. Review and start a new task explicitly.",
      409
    );
  if (error.message?.includes("project_not_found"))
    throw new PublicError(
      "Save this project to your account before starting research.",
      409
    );
  throw new PublicError(
    "Agent task storage is unavailable. Check the saved receipts before retrying; the operator must verify the Agent migration.",
    503
  );
}

/** Only server-authorized state transitions. Never accept status/lease/output from a browser. */
export async function transitionAgentRun(
  sb: SupabaseClient,
  userId: string,
  runId: string,
  action: "claim" | "sources" | "model" | "complete" | "fail" | "cancel",
  lease?: string,
  data?: unknown
) {
  const result = await sb.rpc("transition_agent_run", {
    p_user_id: userId,
    p_run_id: runId,
    p_action: action,
    p_lease: lease ?? null,
    p_data: data ?? null,
  });
  storeError(result.error);
  return result.data ? asRecord(result.data) : null;
}

export async function reserveAgentRun(
  sb: SupabaseClient,
  userId: string,
  command: Extract<z.infer<typeof agentCommandSchema>, { action: "start" }>
) {
  if (command.provider === "deepseek" && !command.deepseekConsent)
    throw new PublicError(
      "Explicitly acknowledge DeepSeek processing before starting this task.",
      400
    );
  const input = normalizeResearchInput(command.input);
  if (!input)
    throw new PublicError(
      "Review the public sources and three trial steps before starting."
    );
  const { data, error } = await sb
    .from("projects")
    .select("id,url,profile,meta")
    .eq("id", command.projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) storeError(error);
  if (!data)
    throw new PublicError(
      "Save this project to your account before starting research.",
      409
    );
  const project = asRecord(data),
    meta = asRecord(project.meta);
  const payload = parseBody(opportunityResearchBodySchema, {
    provider: command.provider,
    input,
    productUrl: project.url,
    profile: project.profile,
    facts: meta.facts,
    successContract: asRecord(meta.workspace).successContract,
    bannedClaims: asRecord(meta.memory).bannedClaims ?? [],
  });
  if (
    command.contextKey !==
    researchContextKey(
      payload.profile,
      payload.facts,
      payload.successContract,
      payload.productUrl,
      payload.bannedClaims
    )
  )
    throw new PublicError(
      "Your saved project and this screen differ. Finish saving, then review the task again.",
      409
    );
  const reserved = await sb.rpc("reserve_agent_run", {
    p_user_id: userId,
    p_project_id: command.projectId,
    p_request_id: command.requestId,
    p_provider: command.provider,
    p_payload: payload,
  });
  storeError(reserved.error);
  const run = publicAgentRun(reserved.data);
  if (!run)
    throw new PublicError(
      "Agent task storage returned an unreadable receipt. Do not repeat the request automatically.",
      503
    );
  return run;
}

/** Request-backed worker, not an always-on scheduler. DB state survives process death;
 * pre-model work can be explicitly resumed, ambiguous paid work is never repeated. */
export async function executeAgentRun(
  sb: SupabaseClient,
  userId: string,
  runId: string
): Promise<void> {
  let lease: string | undefined;
  try {
    const claimed = await transitionAgentRun(sb, userId, runId, "claim");
    if (!claimed) return; // another worker owns it, cancelled, expired or already spent
    lease = asString(claimed.lease_token);
    if (!lease) return;
    const payload = parseBody(opportunityResearchBodySchema, claimed.payload);
    if (claimed.mission_id) {
      const mission = await readAgentMission(sb, userId, asString(claimed.project_id));
      if (
        !mission ||
        mission.id !== claimed.mission_id ||
        mission.revision !== claimed.mission_revision
      )
        throw new PublicError(
          "Daily mission authorization changed; no further work was allowed.",
          409
        );
      const checkContext = async () => {
        if (
          !agentMissionsEnabled() ||
          !mission.enabled ||
          Date.parse(mission.expiresAt) <= Date.now()
        )
          throw new PublicError(
            "Daily mission authorization is paused, expired or disabled.",
            409
          );
        return savedMissionSnapshot(
          sb,
          userId,
          mission.projectId,
          mission.contextKey,
          mission.settings.brief
        );
      };
      const advanceMission = async (
        action: "search" | "sources" | "model" | "complete",
        data?: unknown
      ) => {
        const checked = await checkContext();
        const result = await sb.rpc("transition_agent_mission_run", {
          p_user_id: userId,
          p_run_id: runId,
          p_action: action,
          p_lease: lease,
          p_data: data ?? null,
          p_project_updated_at: checked.updatedAt,
        });
        missionStoreError(result.error);
        if (!result.data)
          throw new PublicError("Daily mission no longer owns this execution.", 409);
      };
      await checkContext();
      const result = await runAutonomousResearch(
        {
          ...payload,
          provider: "openai",
          search: {
            queries: mission.settings.searchQueries,
            domains: mission.settings.allowedDomains,
          },
        },
        {
          beforeSearch: () => advanceMission("search"),
          sources: (sources) => advanceMission("sources", sources),
          beforeModel: () => advanceMission("model"),
        }
      );
      await advanceMission("complete", result);
      return;
    }
    const advance = async (action: "sources" | "model", data?: unknown) => {
      if (!(await transitionAgentRun(sb, userId, runId, action, lease, data)))
        throw new PublicError("Agent task no longer owns this execution.", 409);
    };
    const research = await runOpportunityResearch(payload, {
      sources: (sources) => advance("sources", sources),
      beforeModel: () => advance("model"),
    });
    await transitionAgentRun(sb, userId, runId, "complete", lease, research);
  } catch (error) {
    // Never log submitted content, upstream details or keys. A failed store leaves
    // the lease to expire visibly; the next worker cannot repeat a model attempt.
    if (lease)
      await transitionAgentRun(sb, userId, runId, "fail", lease, {
        message:
          error instanceof PublicError
            ? error.message.slice(0, 400)
            : "Research did not complete. No automatic retry.",
      }).catch(() => {});
  }
}
