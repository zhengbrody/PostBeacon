import { asRecord, asString } from "./coerce";
import { bufferGraphql } from "./bufferProvider";

const POST_FIELDS = "id text channelId channelService dueAt status sentAt";
export interface BufferProviderPost {
  id: string;
  text: string;
  channelId: string;
  service: string;
  dueAt: string;
  status: string;
  sentAt?: string;
}
function providerPost(raw: unknown): BufferProviderPost | undefined {
  const p = asRecord(raw);
  if (
    ![p.id, p.text, p.channelId, p.channelService, p.dueAt, p.status].every(
      (value) => typeof value === "string"
    )
  )
    return;
  if (!asString(p.id) || asString(p.id).length > 200 || asString(p.text).length > 4000)
    return;
  return {
    id: asString(p.id),
    text: asString(p.text),
    channelId: asString(p.channelId),
    service: asString(p.channelService),
    dueAt: asString(p.dueAt),
    status: asString(p.status),
    ...(typeof p.sentAt === "string" ? { sentAt: p.sentAt } : {}),
  };
}
/** One fixed-endpoint mutation, no retries and no caller-provided query/tool.
 * Scheduling means Buffer accepted a future post, never proof of publication. */
export async function createBufferScheduledPost(
  token: string,
  input: { body: string; channelId: string; scheduledAt: string }
): Promise<
  | { kind: "accepted"; post: BufferProviderPost }
  | { kind: "rejected" }
  | { kind: "unknown" }
> {
  try {
    const raw = asRecord(
      await bufferGraphql(
        token,
        `mutation PostBeaconSchedule($input: CreatePostInput!) {
      createPost(input: $input) { __typename ... on PostActionSuccess { post { ${POST_FIELDS} } } ... on MutationError { message } }
    }`,
        {
          input: {
            text: input.body,
            channelId: input.channelId,
            schedulingType: "automatic",
            mode: "customScheduled",
            dueAt: input.scheduledAt,
            assets: [],
            needsApproval: false,
            saveToDraft: false,
            aiAssisted: true,
          },
        }
      )
    );
    // Shared transport returns the GraphQL data object, not a raw HTTP body.
    const action = asRecord(raw.createPost),
      post = providerPost(action.post);
    if (post) return { kind: "accepted", post };
    if (typeof action.message === "string" && !action.post) return { kind: "rejected" };
    return { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}
/** Read only the exact provider ID already attached to an owned delivery. */
export async function readBufferScheduledPost(
  token: string,
  postId: string
): Promise<BufferProviderPost | undefined> {
  try {
    const raw = asRecord(
      await bufferGraphql(
        token,
        `query PostBeaconDelivery($input: PostInput!) { post(input: $input) { ${POST_FIELDS} } }`,
        { input: { id: postId } }
      )
    );
    return providerPost(raw.post);
  } catch {
    return;
  }
}
