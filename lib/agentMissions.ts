import { z } from "zod";
import { asRecord, asString } from "./coerce";
import { trialResearchInputSchema } from "./opportunityResearch";
import { normalizeApprovedDomain, normalizeAutonomousSearch } from "./autonomousResearch";
import type { TrialResearchInput } from "./types";
import type { AgentRun } from "./agentRuns";

const domainSchema = z
  .string()
  .min(3)
  .max(253)
  .transform((value, ctx) => {
    const domain = normalizeApprovedDomain(value);
    if (!domain) {
      ctx.addIssue({ code: "custom", message: "Use an exact allowed public hostname." });
      return z.NEVER;
    }
    return domain;
  });

export const agentMissionSettingsSchema = z
  .object({
    brief: trialResearchInputSchema.refine(
      (input) => input.mode === "product-led" && input.sources.length === 0,
      {
        message:
          "A daily mission requires an explicit product-led Brief without supplied sources.",
      }
    ),
    searchQueries: z.array(z.string().trim().min(3).max(160)).min(1).max(3),
    allowedDomains: z.array(domainSchema).min(1).max(5),
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !normalizeAutonomousSearch({
        queries: value.searchQueries,
        domains: value.allowedDomains,
      })
    )
      ctx.addIssue({
        code: "custom",
        path: ["searchQueries"],
        message: "Only approved public, non-sensitive search text is allowed.",
      });
    if (
      new Set(value.searchQueries.map((query) => query.toLowerCase())).size !==
      value.searchQueries.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["searchQueries"],
        message: "Use distinct approved queries.",
      });
    if (new Set(value.allowedDomains).size !== value.allowedDomains.length)
      ctx.addIssue({
        code: "custom",
        path: ["allowedDomains"],
        message: "Use distinct exact hostnames.",
      });
  });

export interface AgentMissionSettings {
  brief: TrialResearchInput;
  searchQueries: string[];
  allowedDomains: string[];
  enabled: boolean;
}

export interface AgentMission {
  id: string;
  projectId: string;
  revision: number;
  enabled: boolean;
  contextKey: string;
  settings: AgentMissionSettings;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  lastRunAt?: string;
}

export interface AgentMissionList {
  enabled: boolean;
  mission: AgentMission | null;
}
export interface AgentMissionResult extends AgentMissionList {
  run?: AgentRun;
}
export type AgentMissionResponse = AgentMissionResult;

export const agentMissionCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save"),
      projectId: z.uuid(),
      contextKey: z.string().min(1).max(50000),
      expectedRevision: z.number().int().min(1).nullable(),
      settings: agentMissionSettingsSchema,
      consent: z
        .object({ publicSearch: z.boolean(), openaiProcessing: z.boolean() })
        .strict(),
    })
    .strict(),
  z.object({ action: z.literal("pause"), projectId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("run-now"),
      projectId: z.uuid(),
      expectedRevision: z.number().int().min(1),
      contextKey: z.string().min(1).max(50000),
    })
    .strict(),
]);
export type AgentMissionCommand = z.infer<typeof agentMissionCommandSchema>;

export function publicAgentMission(raw: unknown): AgentMission | undefined {
  const row = asRecord(raw);
  const settings = agentMissionSettingsSchema.safeParse(row.settings);
  if (
    !settings.success ||
    !z.uuid().safeParse(row.id).success ||
    !z.uuid().safeParse(row.project_id).success ||
    !Number.isSafeInteger(row.revision) ||
    Number(row.revision) < 1 ||
    typeof row.enabled !== "boolean" ||
    row.enabled !== settings.data.enabled ||
    !asString(row.context_key).trim() ||
    asString(row.context_key).length > 50000 ||
    !Number.isFinite(Date.parse(asString(row.created_at))) ||
    !Number.isFinite(Date.parse(asString(row.updated_at))) ||
    !Number.isFinite(Date.parse(asString(row.expires_at)))
  )
    return undefined;
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    revision: Number(row.revision),
    enabled: row.enabled,
    contextKey: asString(row.context_key),
    settings: settings.data,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    expiresAt: asString(row.expires_at),
    ...(Number.isFinite(Date.parse(asString(row.last_run_at)))
      ? { lastRunAt: asString(row.last_run_at) }
      : {}),
  };
}
