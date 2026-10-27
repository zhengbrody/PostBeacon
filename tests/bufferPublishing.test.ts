import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bufferApprovalHash,
  bufferDeliveryCommandSchema,
  bufferDraftIssues,
  bufferScheduleAllowed,
  type BufferApprovalSnapshot,
} from "@/lib/bufferPublishing";
import { DEMO_PROJECT } from "@/lib/demo";
const seams = vi.hoisted(() => ({ graph: vi.fn() }));
vi.mock("@/lib/bufferProvider", () => ({ bufferGraphql: seams.graph }));
import {
  createBufferScheduledPost,
  readBufferScheduledPost,
} from "@/lib/bufferPublishingProvider";
const snapshot: BufferApprovalSnapshot = {
  approvalNonce: "00000000-0000-4000-8000-000000000009",
  projectId: "00000000-0000-4000-8000-000000000001",
  projectUpdatedAt: "2026-10-26T00:00:00Z",
  connectionId: "00000000-0000-4000-8000-000000000002",
  connectionRevision: 1,
  channelId: "synthetic-channel",
  channelName: "Synthetic",
  platformId: "twitter",
  postIdx: 0,
  body: "A draft\n\nhttps://example.org/",
  scheduledAt: "2026-10-28T00:00:00.000Z",
  timeZone: "UTC",
  contextDigest: "a".repeat(64),
  draftDigest: "b".repeat(64),
  accountQuotaKey: "c".repeat(64),
};
const post = {
  id: "synthetic-post",
  text: snapshot.body,
  channelId: snapshot.channelId,
  channelService: "twitter",
  dueAt: snapshot.scheduledAt,
  status: "scheduled",
  sentAt: null,
};
beforeEach(() => vi.clearAllMocks());
describe("frozen Buffer approval contract", () => {
  it("accepts only the narrow command shape, never client body/media/status/endpoint", () => {
    const command = {
      action: "prepare",
      projectId: snapshot.projectId,
      connectionId: snapshot.connectionId,
      connectionRevision: 1,
      channelId: snapshot.channelId,
      platformId: "twitter",
      postIdx: 0,
      scheduledAt: snapshot.scheduledAt,
      timeZone: "UTC",
    };
    expect(bufferDeliveryCommandSchema.safeParse(command).success).toBe(true);
    for (const patch of [
      { body: "unreviewed" },
      { media: [] },
      { status: "published" },
      { endpoint: "https://untrusted.example" },
      { platformId: "reddit" },
      { timeZone: "Not/AZone" },
      { scheduledAt: "2026-10-28T00:00:00" },
    ])
      expect(bufferDeliveryCommandSchema.safeParse({ ...command, ...patch }).success).toBe(
        false
      );
  });
  it("bounds scheduling to ten minutes through thirty days", () => {
    const now = Date.parse("2026-10-26T00:00:00Z");
    expect(bufferScheduleAllowed(new Date(now + 600_000).toISOString(), now)).toBe(true);
    expect(bufferScheduleAllowed(new Date(now + 599_999).toISOString(), now)).toBe(false);
    expect(
      bufferScheduleAllowed(new Date(now + 30 * 86_400_000 + 1).toISOString(), now)
    ).toBe(false);
    expect(bufferScheduleAllowed("not-a-date", now)).toBe(false);
  });
  it("binds text, destination, schedule, connection and factual context into approval", async () => {
    const hash = await bufferApprovalHash(snapshot);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await bufferApprovalHash({ ...snapshot })).toBe(hash);
    for (const patch of [
      { body: snapshot.body + " " },
      { channelId: "other" },
      { connectionRevision: 2 },
      { scheduledAt: "2026-10-29T00:00:00.000Z" },
      { timeZone: "America/Los_Angeles" },
      { contextDigest: "d".repeat(64) },
      { accountQuotaKey: "e".repeat(64) },
      { approvalNonce: "00000000-0000-4000-8000-000000000008" },
    ])
      expect(await bufferApprovalHash({ ...snapshot, ...patch })).not.toBe(hash);
  });
  it("requires one truthful, single-post public draft and one approved entry", () => {
    const args = {
      post: {
        hook: "Try a sample workflow",
        body: "What was unclear? https://example.org/",
      },
      profile: { ...DEMO_PROJECT.profile, publisherVoice: "brand" as const },
      facts: DEMO_PROJECT.facts,
      platformId: "twitter" as const,
      postIdx: 0,
      plans: [],
      contextKey: "context",
      bannedClaims: [],
      approvedEntry: "https://example.org/",
    };
    expect(bufferDraftIssues(args)).toEqual([]);
    expect(
      bufferDraftIssues({ ...args, post: { ...args.post, body: "No link" } })
    ).not.toEqual([]);
    expect(
      bufferDraftIssues({
        ...args,
        post: { ...args.post, body: args.post.body + " https://other.example/" },
      })
    ).not.toEqual([]);
    expect(
      bufferDraftIssues({
        ...args,
        post: {
          ...args.post,
          body: "x".repeat(200) + "\n\n" + args.post.body,
          hook: "h".repeat(100),
        },
      }).join(" ")
    ).toContain("single post");
    expect(
      bufferDraftIssues({
        ...args,
        post: {
          ...args.post,
          body: "x".repeat(80) + "\n\n" + args.post.body,
          hook: "界".repeat(100),
        },
      }).join(" ")
    ).toContain("single post");
  });
});
describe("bounded Buffer provider protocol", () => {
  it("sends one exact customScheduled mutation through the fixed transport", async () => {
    seams.graph.mockResolvedValue({
      createPost: { __typename: "PostActionSuccess", post },
    });
    expect((await createBufferScheduledPost("test-only", snapshot)).kind).toBe("accepted");
    expect(seams.graph).toHaveBeenCalledOnce();
    const [token, query, variables] = seams.graph.mock.calls[0];
    expect(token).toBe("test-only");
    expect(query).toContain("CreatePostInput!");
    expect(variables.input).toEqual({
      text: snapshot.body,
      channelId: snapshot.channelId,
      schedulingType: "automatic",
      mode: "customScheduled",
      dueAt: snapshot.scheduledAt,
      assets: [],
      needsApproval: false,
      saveToDraft: false,
      aiAssisted: true,
    });
    expect(query).not.toContain(snapshot.body);
    expect(query).toContain("... on MutationError");
  });
  it("keeps uncertain network outcomes unknown and never retries", async () => {
    seams.graph.mockRejectedValue(new Error("secret provider detail"));
    expect(await createBufferScheduledPost("test-only", snapshot)).toEqual({
      kind: "unknown",
    });
    expect(seams.graph).toHaveBeenCalledOnce();
  });
  it("separates an explicit mutation rejection from unknown payloads", async () => {
    seams.graph.mockResolvedValue({ createPost: { message: "private provider message" } });
    expect(await createBufferScheduledPost("test-only", snapshot)).toEqual({
      kind: "rejected",
    });
    seams.graph.mockResolvedValue({ createPost: { post: { id: "incomplete" } } });
    expect(await createBufferScheduledPost("test-only", snapshot)).toEqual({
      kind: "unknown",
    });
  });
  it("reads only one saved provider ID with variables and no mutation", async () => {
    seams.graph.mockResolvedValue({
      post: { ...post, status: "sent", sentAt: "2026-10-28T00:00:01.000Z" },
    });
    expect((await readBufferScheduledPost("test-only", "synthetic-post"))?.status).toBe(
      "sent"
    );
    const [, query, variables] = seams.graph.mock.calls[0];
    expect(query).toContain("PostInput!");
    expect(query).not.toContain("mutation");
    expect(variables).toEqual({ input: { id: "synthetic-post" } });
  });
});
