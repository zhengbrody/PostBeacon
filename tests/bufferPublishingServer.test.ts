import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_PROJECT } from "@/lib/demo";
import { asRecord, asRecordList } from "@/lib/coerce";
const seams = vi.hoisted(() => ({
  enabled: true,
  connection: vi.fn(),
  withToken: vi.fn(),
  create: vi.fn(),
  read: vi.fn(),
  accountKey: vi.fn(),
}));
vi.mock("@/lib/bufferConfig", () => ({ bufferPublishingEnabled: () => seams.enabled }));
vi.mock("@/lib/bufferConnectionServer", () => ({
  getBufferConnection: seams.connection,
  withBufferAccessToken: seams.withToken,
}));
vi.mock("@/lib/bufferCrypto", () => ({ bufferAccountQuotaKey: seams.accountKey }));
vi.mock("@/lib/bufferPublishingProvider", () => ({
  createBufferScheduledPost: seams.create,
  readBufferScheduledPost: seams.read,
}));
import {
  approveBufferDelivery,
  cancelBufferDelivery,
  prepareBufferDelivery,
  publicBufferDelivery,
  reconcileBufferDelivery,
  listBufferDeliveries,
} from "@/lib/bufferPublishingServer";
const uid = "00000000-0000-4000-8000-000000000001",
  projectId = "00000000-0000-4000-8000-000000000002",
  connectionId = "00000000-0000-4000-8000-000000000003",
  deliveryId = "00000000-0000-4000-8000-000000000004";
const now = "2026-10-26T12:00:00.000Z",
  due = "2026-10-27T12:00:00.000Z";
const command = {
  action: "prepare" as const,
  projectId,
  platformId: "twitter" as const,
  postIdx: 0,
  connectionId,
  connectionRevision: 1,
  channelId: "synthetic-channel",
  scheduledAt: due,
  timeZone: "UTC",
};
let accountId: string;
let connection: {
  id: string;
  revision: number;
  status: string;
  channels: { id: string; service: string; name: string }[];
};
let project: Record<string, unknown>;
let row: Record<string, unknown> | undefined;
let rpc: ReturnType<typeof vi.fn>;
let listError: { code: string; message: string } | null;
let markerUsed: boolean;
function store() {
  return {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        maybeSingle: async () => ({
          data:
            table === "projects"
              ? project
              : table === "buffer_connections"
                ? { buffer_account_id: accountId }
                : table === "entitlements"
                  ? { buffer_data_initialized: markerUsed }
                  : row,
          error: null,
        }),
        limit: async () => ({ data: row ? [row] : [], error: listError }),
      };
      return query;
    },
    rpc,
  };
}
let sb: ReturnType<typeof store>;
const prepared = () => prepareBufferDelivery(sb as never, uid, command);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  seams.enabled = true;
  accountId = "same-account";
  listError = null;
  markerUsed = false;
  row = undefined;
  connection = {
    id: connectionId,
    revision: 1,
    status: "connected",
    channels: [{ id: command.channelId, service: "twitter", name: "Synthetic channel" }],
  };
  project = {
    id: projectId,
    url: "https://example.org/",
    updated_at: now,
    profile: {
      ...DEMO_PROJECT.profile,
      name: "Acme",
      publisherVoice: "brand",
      features: ["Acme checks scheduled jobs."],
    },
    result: {
      content: [
        {
          platformId: "twitter",
          posts: [
            {
              hook: "Try one scheduled job check",
              body: "Acme checks scheduled jobs. What was unclear? https://example.org/",
            },
          ],
        },
      ],
    },
    meta: {
      facts: [
        {
          id: "feature",
          field: "features",
          claim: "Acme checks scheduled jobs.",
          sourceType: "user",
          status: "user-confirmed",
          confidence: 1,
          lastVerifiedAt: now,
        },
      ],
      workspace: {
        successContract: {
          primaryGoal: "Useful feedback",
          primarySignal: "replies",
          minimumResult: 1,
          evaluationWindow: "72h",
        },
        plannedExperiments: [],
      },
      memory: { bannedClaims: [] },
    },
  };
  seams.connection.mockImplementation(async () => structuredClone(connection));
  seams.accountKey.mockImplementation((id: string) =>
    id === "same-account" ? "a".repeat(64) : "b".repeat(64)
  );
  seams.withToken.mockImplementation(async (_sb, _user, _id, _revision, callback) =>
    callback("fake-local-token", connection)
  );
  seams.create.mockImplementation(async (_token, input) => ({
    kind: "accepted",
    post: {
      id: "synthetic-provider-post",
      text: input.body,
      channelId: input.channelId,
      service: "twitter",
      dueAt: input.scheduledAt,
      status: "scheduled",
    },
  }));
  rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "prepare_buffer_delivery")
      row = {
        id: deliveryId,
        user_id: uid,
        project_id: projectId,
        connection_id: connectionId,
        connection_revision: 1,
        snapshot: args.p_snapshot,
        approval_hash: args.p_approval_hash,
        status: "awaiting-approval",
        expires_at: new Date(Date.parse(now) + 900_000).toISOString(),
      };
    if (name === "claim_buffer_delivery") {
      if (row?.status !== "awaiting-approval") return { data: null, error: null };
      row = {
        ...row,
        status: "sending",
        attempt_token: "00000000-0000-4000-8000-000000000005",
        attempted_at: now,
      };
    }
    if (name === "finish_buffer_delivery")
      row = { ...row, status: args.p_status, provider_post_id: args.p_provider_post_id };
    if (name === "cancel_buffer_delivery") row = { ...row, status: "cancelled" };
    if (name === "claim_buffer_delivery_read")
      row = { ...row, read_token: "00000000-0000-4000-8000-000000000006" };
    if (name === "observe_buffer_delivery")
      row = {
        ...row,
        status: args.p_status,
        observed_at: now,
        actual_published_at: args.p_actual_published_at,
      };
    return { data: structuredClone(row), error: null };
  });
  sb = store();
});
afterEach(() => vi.useRealTimers());
describe("Buffer delivery server-owned lifecycle", () => {
  it("shows a clean OFF state only for a never-used, uninstalled integration", async () => {
    seams.enabled = false;
    listError = { code: "42P01", message: "missing" };
    expect(await listBufferDeliveries(sb as never, uid, projectId)).toEqual([]);
    markerUsed = true;
    await expect(listBufferDeliveries(sb as never, uid, projectId)).rejects.toMatchObject({
      status: 503,
    });
    markerUsed = false;
    seams.enabled = true;
    await expect(listBufferDeliveries(sb as never, uid, projectId)).rejects.toMatchObject({
      status: 503,
    });
    seams.enabled = false;
    listError = { code: "42501", message: "unreadable" };
    await expect(listBufferDeliveries(sb as never, uid, projectId)).rejects.toMatchObject({
      status: 503,
    });
  });
  it("prepares saved canonical copy without accessing credentials or sending a post", async () => {
    const result = await prepared();
    expect(result.status).toBe("awaiting-approval");
    expect(result.body).toBe(
      "Try one scheduled job check\n\nAcme checks scheduled jobs. What was unclear? https://example.org/"
    );
    expect(seams.withToken).not.toHaveBeenCalled();
    expect(seams.create).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("accountQuotaKey");
    expect(JSON.stringify(result)).not.toContain("fake-local-token");
  });
  it("uses a fresh private nonce rather than reviving an expired approval hash", async () => {
    const first = await prepared();
    vi.setSystemTime(Date.parse(now) + 16 * 60_000);
    const fresh = await prepared();
    expect(fresh.approvalHash).not.toBe(first.approvalHash);
    expect(JSON.stringify(fresh)).not.toContain("approvalNonce");
    expect(seams.create).not.toHaveBeenCalled();
  });
  it("requires verified product facts and the existing truth gate", async () => {
    const meta = asRecord(project.meta);
    meta.facts = [];
    await expect(prepared()).rejects.toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("never shifts a saved draft index past an invalid preceding post", async () => {
    const content = asRecordList(asRecord(project.result).content)[0];
    content.posts = [null, ...asRecordList(content.posts)];
    await expect(prepared()).rejects.toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
    expect(seams.create).not.toHaveBeenCalled();
  });
  it("schedules at most once and does not confuse scheduled with published", async () => {
    const p = await prepared();
    expect(
      (await approveBufferDelivery(sb as never, uid, p.id, p.approvalHash)).status
    ).toBe("scheduled");
    expect(
      (await approveBufferDelivery(sb as never, uid, p.id, p.approvalHash)).status
    ).toBe("scheduled");
    expect(seams.create).toHaveBeenCalledOnce();
    expect(asRecord(asRecord(project.meta).workspace).experiments).toBeUndefined();
  });
  it("rejects a changed draft including whitespace before the one-shot attempt", async () => {
    const p = await prepared();
    const content = asRecordList(asRecord(project.result).content)[0];
    const changedPost = asRecordList(content.posts)[0];
    changedPost.body = String(changedPost.body) + " ";
    await expect(
      approveBufferDelivery(sb as never, uid, p.id, p.approvalHash)
    ).rejects.toMatchObject({ status: 409 });
    expect(seams.create).not.toHaveBeenCalled();
    expect(rpc.mock.calls.some(([name]) => name === "claim_buffer_delivery")).toBe(false);
  });
  it("rejects replaced product context or connection revision", async () => {
    const p = await prepared();
    connection.revision = 2;
    await expect(
      approveBufferDelivery(sb as never, uid, p.id, p.approvalHash)
    ).rejects.toMatchObject({ status: 409 });
    expect(seams.create).not.toHaveBeenCalled();
  });
  it("keeps ambiguous outcomes unknown and never retries the external mutation", async () => {
    const p = await prepared();
    seams.create.mockResolvedValue({ kind: "unknown" });
    expect(
      (await approveBufferDelivery(sb as never, uid, p.id, p.approvalHash)).status
    ).toBe("unknown");
    expect(
      (await approveBufferDelivery(sb as never, uid, p.id, p.approvalHash)).status
    ).toBe("unknown");
    expect(seams.create).toHaveBeenCalledOnce();
    await expect(cancelBufferDelivery(sb as never, uid, p.id)).rejects.toMatchObject({
      status: 409,
    });
  });
  it("fails closed if the final atomic claim fails", async () => {
    const p = await prepared();
    rpc.mockImplementationOnce(async () => ({
      data: null,
      error: { message: "draft_conflict private detail" },
    }));
    await expect(
      approveBufferDelivery(sb as never, uid, p.id, p.approvalHash)
    ).rejects.toMatchObject({ status: 409 });
    expect(seams.create).not.toHaveBeenCalled();
  });
  it("allows only local unsent cancellation, including when the feature is switched off", async () => {
    const p = await prepared();
    seams.enabled = false;
    expect((await cancelBufferDelivery(sb as never, uid, p.id)).status).toBe("cancelled");
    expect(seams.create).not.toHaveBeenCalled();
    await expect(
      approveBufferDelivery(sb as never, uid, p.id, p.approvalHash)
    ).rejects.toMatchObject({ status: 503 });
  });
  it("reads a scheduled post after a metadata revision change only for the same provider account", async () => {
    const p = await prepared();
    await approveBufferDelivery(sb as never, uid, p.id, p.approvalHash);
    connection.revision = 2;
    seams.read.mockResolvedValue({
      id: "synthetic-provider-post",
      text: p.body,
      channelId: p.channelId,
      service: "twitter",
      dueAt: p.scheduledAt,
      status: "sent",
      sentAt: now,
    });
    const result = await reconcileBufferDelivery(sb as never, uid, p.id);
    expect(result.status).toBe("published");
    expect(result.actualPublishedAt).toBe(now);
    expect(seams.withToken.mock.calls.at(-1)?.[3]).toBe(2);
    accountId = "replacement-account";
    await expect(reconcileBufferDelivery(sb as never, uid, p.id)).rejects.toMatchObject({
      status: 409,
    });
    expect(seams.read).toHaveBeenCalledOnce();
  });
  it.each(["body", "channel", "time", "missing-sent-at"])(
    "does not claim publication when provider %s differs",
    async (defect) => {
      const p = await prepared();
      await approveBufferDelivery(sb as never, uid, p.id, p.approvalHash);
      seams.read.mockResolvedValue({
        id: "synthetic-provider-post",
        text: defect === "body" ? "replacement" : p.body,
        channelId: defect === "channel" ? "other" : p.channelId,
        service: "twitter",
        dueAt: defect === "time" ? "2026-10-29T00:00:00Z" : p.scheduledAt,
        status: "sent",
        ...(defect === "missing-sent-at" ? {} : { sentAt: now }),
      });
      expect((await reconcileBufferDelivery(sb as never, uid, p.id)).status).toBe(
        "unknown"
      );
    }
  );
  it("projects expired and stranded sending receipts honestly without exposing private metadata", async () => {
    await prepared();
    expect(
      publicBufferDelivery({ ...row, expires_at: "2026-10-26T00:00:00Z" })?.status
    ).toBe("expired");
    expect(
      publicBufferDelivery({
        ...row,
        status: "sending",
        attempted_at: "2026-10-26T00:00:00Z",
      })?.status
    ).toBe("unknown");
    expect(publicBufferDelivery({ ...row, expires_at: "invalid" })).toBeUndefined();
    expect(publicBufferDelivery({})).toBeUndefined();
  });
});
