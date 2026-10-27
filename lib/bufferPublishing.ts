import { z } from "zod";
import { auditDraftSafety, charBudget, platformCharLimit } from "./contentSafety";
import { trialDraftIssues } from "./trialDraftSafety";
import { researchUrl } from "./opportunityResearch";
import { trialEditorialIssues } from "./trialEditorial";
import type { Fact, PlannedExperiment, PlatformPost, ProductProfile } from "./types";

const id = z.string().trim().min(1).max(200);
const timeZone = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Use a valid time zone.");
export const bufferDeliveryStatusSchema = z.enum([
  "awaiting-approval",
  "sending",
  "scheduled",
  "published",
  "failed",
  "unknown",
  "cancelled",
  "expired",
]);
export const bufferDeliverySchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  status: bufferDeliveryStatusSchema,
  body: z.string().min(1).max(4000),
  platformId: z.enum(["twitter", "linkedin"]),
  postIdx: z.number().int().min(0).max(11),
  channelId: id,
  channelName: z.string().min(1).max(300),
  connectionId: z.uuid(),
  connectionRevision: z.number().int().positive(),
  scheduledAt: z.iso.datetime(),
  timeZone,
  approvalHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime(),
  providerPostId: id.optional(),
  message: z.string().max(600).optional(),
  observedAt: z.iso.datetime().optional(),
  actualPublishedAt: z.iso.datetime().optional(),
});
export type BufferDelivery = z.infer<typeof bufferDeliverySchema>;
export interface BufferDeliveryList {
  enabled: boolean;
  deliveries: BufferDelivery[];
}
export interface BufferDeliveryResult {
  enabled: boolean;
  delivery: BufferDelivery;
}
export const bufferPrepareSchema = z
  .object({
    action: z.literal("prepare"),
    projectId: z.uuid(),
    platformId: z.enum(["twitter", "linkedin"]),
    postIdx: z.number().int().min(0).max(11),
    connectionId: z.uuid(),
    connectionRevision: z.number().int().positive(),
    channelId: id,
    scheduledAt: z.iso.datetime(),
    timeZone,
  })
  .strict();
export const bufferDeliveryCommandSchema = z.discriminatedUnion("action", [
  bufferPrepareSchema,
  z
    .object({
      action: z.literal("approve"),
      deliveryId: z.uuid(),
      approvalHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({ action: z.enum(["read-reconcile", "cancel-local"]), deliveryId: z.uuid() })
    .strict(),
]);
export type BufferDeliveryCommand = z.infer<typeof bufferDeliveryCommandSchema>;
export function bufferScheduleAllowed(scheduledAt: string, now = Date.now()): boolean {
  const value = Date.parse(scheduledAt);
  return (
    Number.isFinite(value) && value >= now + 10 * 60_000 && value <= now + 30 * 86_400_000
  );
}
export const bufferApprovalSnapshotSchema = bufferPrepareSchema
  .omit({ action: true })
  .extend({
    approvalNonce: z.uuid(),
    projectUpdatedAt: z
      .string()
      .min(1)
      .max(40)
      .refine((value) => Number.isFinite(Date.parse(value))),
    channelName: z.string().min(1).max(300),
    body: z.string().min(1).max(4000),
    contextDigest: z.string().regex(/^[a-f0-9]{64}$/),
    draftDigest: z.string().regex(/^[a-f0-9]{64}$/),
    accountQuotaKey: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type BufferApprovalSnapshot = z.infer<typeof bufferApprovalSnapshotSchema>;
export function bufferDraftIssues(args: {
  post: Pick<PlatformPost, "hook" | "body">;
  profile: ProductProfile;
  facts: Fact[];
  platformId: "twitter" | "linkedin";
  postIdx: number;
  plans: readonly PlannedExperiment[];
  contextKey: string;
  bannedClaims: readonly string[];
  approvedEntry: string;
}): string[] {
  const issues = auditDraftSafety(
    args.post,
    args.facts,
    args.profile,
    args.platformId
  ).issues.map((issue) => issue.title);
  issues.push(
    ...trialDraftIssues(
      args.platformId,
      args.postIdx,
      args.post,
      args.plans,
      args.contextKey,
      args.bannedClaims
    )
  );
  issues.push(
    ...trialEditorialIssues(
      args.post,
      args.facts.map((fact) => fact.id),
      args.platformId
    )
  );
  const text = `${args.post.hook}\n\n${args.post.body}`;
  const limit = platformCharLimit(args.platformId);
  const weighted = Array.from(text).reduce(
    (count, char) => count + (char.charCodeAt(0) <= 0x7f ? 1 : 2),
    0
  );
  if (
    !limit ||
    !charBudget(args.post, limit).fitsSingle ||
    text.length > limit ||
    (args.platformId === "twitter" && weighted > limit)
  )
    issues.push(
      "This approval supports one single post only. Shorten the copy; threads are not sent automatically."
    );
  const links = text.match(/https?:\/\/[^\s<>"')]+/gi) ?? [];
  if (
    links.length !== 1 ||
    !(args.post.body.match(/https?:\/\/[^\s<>"')]+/gi) ?? []).some((link) => {
      try {
        return researchUrl(link) === args.approvedEntry;
      } catch {
        return false;
      }
    }) ||
    links.some((link) => {
      try {
        return researchUrl(link) !== args.approvedEntry;
      } catch {
        return true;
      }
    })
  )
    issues.push(
      "Use exactly one approved product-entry link in the body, with no other links."
    );
  if (
    args.bannedClaims.some(
      (claim) =>
        claim.trim() && text.toLocaleLowerCase().includes(claim.trim().toLocaleLowerCase())
    )
  )
    issues.push("This draft contains a claim marked as never to use.");
  return [...new Set(issues)];
}
export async function bufferDigest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
export async function bufferApprovalHash(
  snapshot: BufferApprovalSnapshot
): Promise<string> {
  // Explicit key order makes the frozen confirmation independent of JSONB ordering.
  return bufferDigest(
    JSON.stringify([
      "buffer-approval-v1",
      snapshot.projectId,
      snapshot.projectUpdatedAt,
      snapshot.connectionId,
      snapshot.connectionRevision,
      snapshot.channelId,
      snapshot.channelName,
      snapshot.platformId,
      snapshot.postIdx,
      snapshot.body,
      snapshot.scheduledAt,
      snapshot.timeZone,
      snapshot.contextDigest,
      snapshot.draftDigest,
      snapshot.accountQuotaKey,
      snapshot.approvalNonce,
    ])
  );
}
