import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { asRecord, asRecordList, asString } from "./coerce";
import { PublicError } from "./errors";
import {
  generateBodySchema,
  opportunityResearchBodySchema,
  successContractSchema,
  parseBody,
} from "./validate";
import { normalizePlannedExperiments, MAX_PLANNED_EXPERIMENTS } from "./experimentQueue";
import {
  normalizeTrialSnapshot,
  productTrialEntry,
  researchContextKey,
  trialProductFacts,
} from "./opportunityResearch";
import { getBufferConnection, withBufferAccessToken } from "./bufferConnectionServer";
import { bufferAccountQuotaKey } from "./bufferCrypto";
import {
  createBufferScheduledPost,
  readBufferScheduledPost,
  type BufferProviderPost,
} from "./bufferPublishingProvider";
import {
  bufferApprovalHash,
  bufferDigest,
  bufferDraftIssues,
  bufferDeliverySchema,
  bufferDeliveryStatusSchema,
  bufferApprovalSnapshotSchema,
  bufferScheduleAllowed,
  type BufferApprovalSnapshot,
  type BufferDelivery,
  type BufferDeliveryCommand,
} from "./bufferPublishing";

import { bufferPublishingEnabled } from "./bufferConfig";
export { bufferPublishingEnabled } from "./bufferConfig";
const unavailable = () =>
  new PublicError(
    "Publishing receipts are unavailable. Do not resend an uncertain delivery; check Buffer directly.",
    503
  );
export function bufferDeliveryStoreError(error: { message?: string } | null) {
  if (!error) return;
  if (error.message?.includes("duplicate_active_delivery"))
    throw new PublicError(
      "A matching approval or delivery already exists for this account, channel, text and time. Review its receipt; do not resend an uncertain post.",
      409
    );
  if (
    error.message?.includes("budget_exhausted") ||
    error.message?.includes("read_limited")
  )
    throw new PublicError(
      "The bounded publishing allowance is used up. Check saved receipts before trying later.",
      429
    );
  if (error.message?.includes("conflict"))
    throw new PublicError(
      "The saved draft or connection changed. Prepare and approve a fresh preview.",
      409
    );
  if (error.message?.includes("invalid_schedule"))
    throw new PublicError(
      "Choose a UTC publishing time between ten minutes and thirty days from now.",
      400
    );
  throw unavailable();
}
function statusMessage(status: BufferDelivery["status"]): string {
  switch (status) {
    case "awaiting-approval":
      return "Preview only. No post has been sent to Buffer. Approval expires shortly.";
    case "sending":
      return "One scheduling attempt is in progress. Do not submit a replacement.";
    case "scheduled":
      return "Buffer accepted a scheduled post. This is not proof of publication; cancelling locally cannot recall it.";
    case "published":
      return "Buffer reports this exact post as sent. This receipt does not create a measured growth experiment.";
    case "failed":
      return "The provider reported a failure. Review Buffer before preparing any replacement.";
    case "unknown":
      return "Delivery is uncertain. Do not resend: it may already be scheduled. Check Buffer directly.";
    case "cancelled":
      return "Unsent local approval cancelled. No remote cancellation was attempted.";
    case "expired":
      return "Approval expired without a new scheduling attempt. Prepare a fresh preview.";
  }
}
export function publicBufferDelivery(raw: unknown): BufferDelivery | undefined {
  const row = asRecord(raw),
    s = asRecord(row.snapshot);
  const parsedStatus = bufferDeliveryStatusSchema.safeParse(row.status);
  if (!parsedStatus.success) return;
  let status = parsedStatus.data;
  const iso = (value: unknown) =>
    typeof value === "string" && Number.isFinite(Date.parse(value))
      ? new Date(value).toISOString()
      : undefined;
  if (status === "awaiting-approval" && Date.parse(asString(row.expires_at)) <= Date.now())
    status = "expired";
  if (status === "sending" && Date.parse(asString(row.attempted_at)) + 60_000 < Date.now())
    status = "unknown";
  const parsed = bufferDeliverySchema.safeParse({
    id: row.id,
    projectId: row.project_id,
    status,
    body: s.body,
    platformId: s.platformId,
    postIdx: s.postIdx,
    channelId: s.channelId,
    channelName: s.channelName,
    connectionId: row.connection_id,
    connectionRevision: row.connection_revision,
    scheduledAt: s.scheduledAt,
    timeZone: s.timeZone,
    approvalHash: row.approval_hash,
    expiresAt: iso(row.expires_at),
    ...(row.provider_post_id ? { providerPostId: row.provider_post_id } : {}),
    ...(row.observed_at ? { observedAt: iso(row.observed_at) } : {}),
    ...(row.actual_published_at ? { actualPublishedAt: iso(row.actual_published_at) } : {}),
    message: statusMessage(status),
  });
  return parsed.success ? parsed.data : undefined;
}
async function readOwned(sb: SupabaseClient, userId: string, deliveryId: string) {
  const { data, error } = await sb
    .from("buffer_deliveries")
    .select("*")
    .eq("id", deliveryId)
    .eq("user_id", userId)
    .maybeSingle();
  bufferDeliveryStoreError(error);
  if (!data) throw new PublicError("This publishing receipt is unavailable.", 404);
  return asRecord(data);
}
function receipt(row: unknown): BufferDelivery {
  const delivery = publicBufferDelivery(row);
  if (!delivery) throw unavailable();
  return delivery;
}
export async function listBufferDeliveries(
  sb: SupabaseClient,
  userId: string,
  projectId: string
): Promise<BufferDelivery[]> {
  const owner = await sb
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  bufferDeliveryStoreError(owner.error);
  if (!owner.data) throw new PublicError("Save this project to your account first.", 404);
  const { data, error } = await sb
    .from("buffer_deliveries")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error && ["42P01", "PGRST205"].includes(error.code) && !bufferPublishingEnabled()) {
    const marker = await sb
      .from("entitlements")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    bufferDeliveryStoreError(marker.error);
    if (asRecord(marker.data).buffer_data_initialized === true) throw unavailable();
    return [];
  }
  bufferDeliveryStoreError(error);
  return asRecordList(data).map(receipt);
}
async function currentSnapshot(
  sb: SupabaseClient,
  userId: string,
  command: Extract<BufferDeliveryCommand, { action: "prepare" }>,
  approvalNonce: string
): Promise<BufferApprovalSnapshot> {
  const { data, error } = await sb
    .from("projects")
    .select("id,url,profile,result,meta,updated_at")
    .eq("id", command.projectId)
    .eq("user_id", userId)
    .maybeSingle();
  bufferDeliveryStoreError(error);
  if (!data) throw new PublicError("Save this project before preparing a delivery.", 409);
  const p = asRecord(data),
    meta = asRecord(p.meta),
    workspace = asRecord(meta.workspace);
  const profile = parseBody(generateBodySchema.shape.profile, p.profile),
    facts = parseBody(opportunityResearchBodySchema.shape.facts, meta.facts),
    contract = parseBody(successContractSchema, workspace.successContract);
  if (!trialProductFacts(facts).length)
    throw new PublicError("Confirm product facts before scheduling a public post.", 409);
  const banned = parseBody(
    z.array(z.string().max(200)).max(20),
    asRecord(meta.memory).bannedClaims ?? []
  );
  const channelContent = asRecordList(asRecord(p.result).content).find(
    (item) => item.platformId === command.platformId
  );
  const rawPosts = channelContent?.posts;
  const post = parseBody(
    z.object({
      hook: z
        .string()
        .min(1)
        .max(1000)
        .refine((value) => Boolean(value.trim())),
      body: z
        .string()
        .min(1)
        .max(4000)
        .refine((value) => Boolean(value.trim())),
    }),
    Array.isArray(rawPosts) ? rawPosts[command.postIdx] : undefined
  );
  const rawPlans = asRecordList(workspace.plannedExperiments);
  if (
    Array.isArray(workspace.plannedExperiments) &&
    workspace.plannedExperiments.length > MAX_PLANNED_EXPERIMENTS
  )
    throw new PublicError(
      "The saved experiment queue is too large to validate safely. Review and save it before scheduling.",
      409
    );
  if (
    rawPlans.some(
      (plan) =>
        plan.platformId === command.platformId &&
        plan.postIdx === command.postIdx &&
        plan.opportunity &&
        (!normalizeTrialSnapshot(plan.opportunity) || plan.status === "cancelled")
    )
  )
    throw new PublicError(
      "This trial was cancelled or its reviewed evidence is unreadable. Review a fresh trial before scheduling.",
      409
    );
  const plans = normalizePlannedExperiments(workspace.plannedExperiments);
  if (
    rawPlans.some(
      (plan) =>
        plan.platformId === command.platformId &&
        plan.postIdx === command.postIdx &&
        plan.opportunity &&
        !plans.some(
          (normalized) =>
            normalized.id === plan.id &&
            normalized.platformId === command.platformId &&
            normalized.postIdx === command.postIdx
        )
    )
  )
    throw new PublicError(
      "The reviewed trial could not be restored without changing its identity. Review a fresh trial before scheduling.",
      409
    );
  const matching = plans.find(
    (plan) =>
      plan.platformId === command.platformId &&
      plan.postIdx === command.postIdx &&
      plan.opportunity
  );
  const context = researchContextKey(profile, facts, contract, asString(p.url), banned);
  const entry = matching?.opportunity?.entryUrl ?? productTrialEntry(asString(p.url));
  const issues = bufferDraftIssues({
    post,
    profile,
    facts,
    platformId: command.platformId,
    postIdx: command.postIdx,
    plans,
    contextKey: context,
    bannedClaims: banned,
    approvedEntry: entry,
  });
  if (issues.length) throw new PublicError(`Scheduling blocked: ${issues.join(" ")}`, 409);
  const connection = await getBufferConnection(sb, userId);
  if (
    !connection ||
    connection.id !== command.connectionId ||
    connection.revision !== command.connectionRevision ||
    connection.status !== "connected"
  )
    throw new PublicError(
      "The publishing connection changed. Reconnect and prepare a fresh preview.",
      409
    );
  const channel = connection.channels.find(
    (item) => item.id === command.channelId && item.service === command.platformId
  );
  if (!channel)
    throw new PublicError("Choose a verified connected channel for this draft.", 409);
  const privateConnection = await sb
    .from("buffer_connections")
    .select("buffer_account_id")
    .eq("id", connection.id)
    .eq("user_id", userId)
    .eq("revision", connection.revision)
    .eq("status", "connected")
    .maybeSingle();
  bufferDeliveryStoreError(privateConnection.error);
  const accountId = asString(asRecord(privateConnection.data).buffer_account_id);
  if (!accountId) throw unavailable();
  const updatedAt = asString(p.updated_at);
  if (!Number.isFinite(Date.parse(updatedAt))) throw unavailable();
  return {
    approvalNonce,
    projectId: command.projectId,
    projectUpdatedAt: updatedAt,
    connectionId: connection.id,
    connectionRevision: connection.revision,
    channelId: channel.id,
    channelName: channel.name,
    platformId: command.platformId,
    postIdx: command.postIdx,
    body: `${post.hook}\n\n${post.body}`,
    scheduledAt: new Date(command.scheduledAt).toISOString(),
    timeZone: command.timeZone,
    contextDigest: await bufferDigest(context),
    draftDigest: await bufferDigest(JSON.stringify({ post, plans: matching ?? null })),
    accountQuotaKey: bufferAccountQuotaKey(accountId),
  };
}
export async function prepareBufferDelivery(
  sb: SupabaseClient,
  userId: string,
  command: Extract<BufferDeliveryCommand, { action: "prepare" }>
): Promise<BufferDelivery> {
  if (!bufferPublishingEnabled())
    throw new PublicError("Approved scheduling is not enabled.", 503);
  if (!bufferScheduleAllowed(command.scheduledAt))
    throw new PublicError(
      "Choose a publishing time between ten minutes and thirty days from now.",
      400
    );
  const snapshot = await currentSnapshot(sb, userId, command, crypto.randomUUID()),
    hash = await bufferApprovalHash(snapshot);
  const { data, error } = await sb.rpc("prepare_buffer_delivery", {
    p_user_id: userId,
    p_project_id: snapshot.projectId,
    p_connection_id: snapshot.connectionId,
    p_connection_revision: snapshot.connectionRevision,
    p_project_updated_at: snapshot.projectUpdatedAt,
    p_approval_hash: hash,
    p_account_quota_key: snapshot.accountQuotaKey,
    p_snapshot: snapshot,
  });
  bufferDeliveryStoreError(error);
  return receipt(data);
}
function matches(post: BufferProviderPost, snapshot: BufferApprovalSnapshot): boolean {
  return (
    post.text === snapshot.body &&
    post.channelId === snapshot.channelId &&
    post.service === snapshot.platformId &&
    Date.parse(post.dueAt) === Date.parse(snapshot.scheduledAt)
  );
}
export async function approveBufferDelivery(
  sb: SupabaseClient,
  userId: string,
  deliveryId: string,
  hash: string
): Promise<BufferDelivery> {
  if (!bufferPublishingEnabled())
    throw new PublicError("Approved scheduling is not enabled.", 503);
  const row = await readOwned(sb, userId, deliveryId),
    old = receipt(row);
  if (old.approvalHash !== hash)
    throw new PublicError("This approval does not match the preview.", 409);
  if (old.status !== "awaiting-approval") return old;
  const frozen = parseBody(bufferApprovalSnapshotSchema, row.snapshot);
  return withBufferAccessToken(
    sb,
    userId,
    old.connectionId,
    old.connectionRevision,
    async (token) => {
      const snapshot = await currentSnapshot(
        sb,
        userId,
        {
          action: "prepare",
          projectId: old.projectId,
          platformId: old.platformId,
          postIdx: old.postIdx,
          connectionId: old.connectionId,
          connectionRevision: old.connectionRevision,
          channelId: old.channelId,
          scheduledAt: old.scheduledAt,
          timeZone: old.timeZone,
        },
        frozen.approvalNonce
      );
      if ((await bufferApprovalHash(snapshot)) !== hash)
        throw new PublicError(
          "Draft, context or destination changed. Prepare a fresh preview.",
          409
        );
      const claim = await sb.rpc("claim_buffer_delivery", {
        p_user_id: userId,
        p_delivery_id: deliveryId,
        p_approval_hash: hash,
        p_project_updated_at: snapshot.projectUpdatedAt,
        p_connection_revision: snapshot.connectionRevision,
      });
      bufferDeliveryStoreError(claim.error);
      if (!claim.data) return receipt(await readOwned(sb, userId, deliveryId));
      const claimed = asRecord(claim.data),
        attempt = asString(claimed.attempt_token);
      if (!attempt) throw unavailable();
      // This checkpoint consumes the one-shot approval. No catch path can retry it.
      const result = await createBufferScheduledPost(token, snapshot);
      const status =
        result.kind === "rejected"
          ? "failed"
          : result.kind === "accepted" &&
              matches(result.post, snapshot) &&
              result.post.status === "scheduled"
            ? "scheduled"
            : "unknown";
      const finish = await sb.rpc("finish_buffer_delivery", {
        p_user_id: userId,
        p_delivery_id: deliveryId,
        p_attempt_token: attempt,
        p_status: status,
        p_provider_post_id: result.kind === "accepted" ? result.post.id : null,
      });
      bufferDeliveryStoreError(finish.error);
      return receipt(finish.data ?? (await readOwned(sb, userId, deliveryId)));
    }
  );
}
export async function cancelBufferDelivery(
  sb: SupabaseClient,
  userId: string,
  deliveryId: string
): Promise<BufferDelivery> {
  const row = await readOwned(sb, userId, deliveryId),
    old = receipt(row);
  if (old.status !== "awaiting-approval")
    throw new PublicError(
      "Only an unsent local approval can be cancelled here. Scheduled or uncertain posts must be checked in Buffer; local deletion does not recall them.",
      409
    );
  const { data, error } = await sb.rpc("cancel_buffer_delivery", {
    p_user_id: userId,
    p_delivery_id: deliveryId,
  });
  bufferDeliveryStoreError(error);
  return receipt(data ?? (await readOwned(sb, userId, deliveryId)));
}
export async function reconcileBufferDelivery(
  sb: SupabaseClient,
  userId: string,
  deliveryId: string
): Promise<BufferDelivery> {
  if (!bufferPublishingEnabled())
    throw new PublicError("External status checking is not enabled.", 503);
  const row = await readOwned(sb, userId, deliveryId),
    old = receipt(row);
  if (!old.providerPostId)
    throw new PublicError(
      "No provider post ID was received. Do not resend; check Buffer directly.",
      409
    );
  const providerPostId = old.providerPostId;
  const snapshot = parseBody(bufferApprovalSnapshotSchema, row.snapshot);
  const connection = await getBufferConnection(sb, userId);
  if (
    !connection ||
    connection.id !== old.connectionId ||
    connection.status !== "connected"
  )
    throw new PublicError(
      "Reconnect the same Buffer account to read its saved delivery status.",
      409
    );
  return withBufferAccessToken(
    sb,
    userId,
    old.connectionId,
    connection.revision,
    async (token) => {
      const account = await sb
        .from("buffer_connections")
        .select("buffer_account_id")
        .eq("id", connection.id)
        .eq("user_id", userId)
        .eq("revision", connection.revision)
        .eq("status", "connected")
        .maybeSingle();
      bufferDeliveryStoreError(account.error);
      const accountId = asString(asRecord(account.data).buffer_account_id);
      if (!accountId || bufferAccountQuotaKey(accountId) !== snapshot.accountQuotaKey)
        throw new PublicError(
          "This receipt belongs to a different Buffer account. Status checking cannot use the replacement account.",
          409
        );
      const claim = await sb.rpc("claim_buffer_delivery_read", {
        p_user_id: userId,
        p_delivery_id: deliveryId,
      });
      bufferDeliveryStoreError(claim.error);
      if (!claim.data) return receipt(await readOwned(sb, userId, deliveryId));
      const nonce = asString(asRecord(claim.data).read_token);
      if (!nonce) throw unavailable();
      const post = await readBufferScheduledPost(token, providerPostId);
      const valid = post && post.id === providerPostId && matches(post, snapshot);
      const published =
        valid &&
        post.status === "sent" &&
        post.sentAt &&
        Number.isFinite(Date.parse(post.sentAt)) &&
        Date.parse(post.sentAt) >= Date.parse(asString(row.attempted_at)) - 60_000 &&
        Date.parse(post.sentAt) <= Date.now() + 60_000;
      const status = published
        ? "published"
        : valid && post.status === "scheduled"
          ? "scheduled"
          : valid && post.status === "error"
            ? "failed"
            : "unknown";
      const result = await sb.rpc("observe_buffer_delivery", {
        p_user_id: userId,
        p_delivery_id: deliveryId,
        p_read_token: nonce,
        p_status: status,
        p_actual_published_at: published && post ? post.sentAt : null,
      });
      bufferDeliveryStoreError(result.error);
      return receipt(result.data ?? (await readOwned(sb, userId, deliveryId)));
    }
  );
}
