import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resetWorkspaceTableCache, syncWorkspaceTables } from "@/lib/workspace";
import type { WorkspaceState } from "@/lib/types";

function mirrorClient() {
  const writes: Record<string, unknown[]> = {};
  const client = {
    from(table: string) {
      return {
        select() {
          return {
            limit: async () => ({ data: [], error: null }),
          };
        },
        upsert(rows: unknown) {
          writes[table] = Array.isArray(rows) ? rows : [rows];
          const result = { data: null, error: null };
          return {
            select: () => ({
              single: async () => ({ data: { id: "campaign-1" }, error: null }),
            }),
            then: (
              resolve: (value: typeof result) => unknown,
              reject?: (reason: unknown) => unknown
            ) => Promise.resolve(result).then(resolve, reject),
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, writes };
}

describe("normalized workspace mirror", () => {
  it("persists the checkpoint verdict and makes unsafe tracked URLs absent", async () => {
    resetWorkspaceTableCache();
    const { client, writes } = mirrorClient();
    const verdict = {
      call: "promising" as const,
      reason: "real replies",
      advice: "continue",
      decidedAt: "2026-08-02T12:00:00.000Z",
    };
    const workspace: WorkspaceState = {
      experiments: [
        {
          id: "experiment-1",
          platformId: "reddit",
          platformName: "Reddit",
          community: "r/test",
          angle: "angle",
          variant: "hook",
          hypothesis: "replies",
          trackedUrl: "javascript:alert(1)",
          publishedAt: "2026-08-01T12:00:00.000Z",
          status: "analyzed",
          postIdx: 0,
          outcomes: [
            {
              id: "outcome-1",
              checkpoint: "24h",
              recordedAt: verdict.decidedAt,
              replies: 4,
              verdict,
            },
          ],
          verdict,
        },
      ],
      taskLog: [],
    };

    await syncWorkspaceTables(client, "user-1", "project-1", {
      workspace,
      profile: null,
      launchDate: "",
    });

    expect(writes.experiments[0]).toMatchObject({ tracked_url: null });
    expect(writes.outcomes[0]).toMatchObject({ verdict });
  });
});
