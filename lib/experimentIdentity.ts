/** Identity helpers keep a draft, its execution and its checkpoint tasks from
 * collapsing into one platform-level flag. */
export const draftExecutionKey = (platformId: string, postIdx: number) =>
  `${platformId}-${postIdx}`;

export const postTaskId = (platformId: string, postIdx: number) =>
  `post:${platformId}:${postIdx}`;

/** Read both the v7 identity and the legacy platform-only first task. */
export function draftKeyFromPostTaskId(taskId: string): string | undefined {
  const current = /^post:([^:]+):(\d+)$/.exec(taskId);
  if (current) return draftExecutionKey(current[1], Number(current[2]));
  const legacy = /^post:([^:]+)$/.exec(taskId);
  return legacy ? draftExecutionKey(legacy[1], 0) : undefined;
}

export const recordTaskId = (experimentId: string, checkpoint: "24h" | "72h") =>
  `record:${experimentId}:${checkpoint}`;
