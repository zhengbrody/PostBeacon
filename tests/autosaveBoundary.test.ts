// @vitest-environment jsdom
import { act } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useAutosave } from "@/hooks/useAutosave";
import { DEMO_PROJECT } from "@/lib/demo";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deferred, mountHook } from "./helpers/reactHook";
const storage = vi.hoisted(() => ({ clear: vi.fn(), save: vi.fn(), mirror: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  DRAFT_SCHEMA_VERSION: 11,
  clearDraft: storage.clear,
  saveDraft: storage.save,
}));
vi.mock("@/lib/workspace", () => ({ syncWorkspaceTables: storage.mirror }));
type Flow = Parameters<typeof useAutosave>[0];
type Auth = Parameters<typeof useAutosave>[1];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  storage.mirror.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());
const flow = (name = "Original", id = "project-A"): Flow => ({
  projectId: id,
  setProjectId: vi.fn(),
  launchDate: "",
  demo: false,
  snapshot: {
    url: "https://example.org",
    profile: { ...DEMO_PROJECT.profile, name },
    strategy: DEMO_PROJECT.strategy,
    result: DEMO_PROJECT.result,
    facts: [],
    analysisReceipt: null,
    posted: {},
    selected: ["twitter"],
    workspace: { experiments: [], taskLog: [] },
    memory: { bannedClaims: [], angles: [], rewriteFeedback: [], userEditedFields: [] },
  },
});
function client(getUser: ReturnType<typeof vi.fn>, upsert: ReturnType<typeof vi.fn>) {
  return { auth: { getUser }, from: () => ({ upsert }) } as unknown as SupabaseClient;
}
const useRenderedAutosave = (props: { flow: Flow; auth: Auth }) =>
  useAutosave(props.flow, props.auth);

describe("real autosave Hook under delayed requests", () => {
  it("serializes older and newer saves so the old response cannot overwrite the latest", async () => {
    const gate = deferred<{ error: null }>();
    const upsert = vi
      .fn()
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValue({ error: null });
    const sb = client(vi.fn().mockResolvedValue({ data: { user: { id: "A" } } }), upsert);
    const hook = await mountHook(useRenderedAutosave, {
      flow: flow("Old"),
      auth: { userId: "A", supabase: sb },
    });
    let old!: Promise<boolean>, next!: Promise<boolean>;
    try {
      await act(async () => {
        old = hook.current.saveNow();
      });
      expect(upsert).toHaveBeenCalledTimes(1);
      await hook.render({ flow: flow("New"), auth: { userId: "A", supabase: sb } });
      await act(async () => {
        next = hook.current.saveNow();
      });
      expect(upsert).toHaveBeenCalledTimes(1);
      await act(async () => {
        gate.resolve({ error: null });
        await Promise.all([old, next]);
      });
      expect(await old).toBe(true);
      expect(await next).toBe(true);
      expect(upsert.mock.calls.map(([row]) => row.profile.name)).toEqual(["Old", "New"]);
      expect(hook.current.lastSaved).not.toBe("");
    } finally {
      await hook.unmount();
    }
  });
  it("drops an old account save if identity changes while getUser is pending", async () => {
    const gate = deferred<{ data: { user: { id: string } } }>();
    const upsert = vi.fn();
    const sb = client(vi.fn().mockReturnValue(gate.promise), upsert);
    const hook = await mountHook(useRenderedAutosave, {
      flow: flow(),
      auth: { userId: "A", supabase: sb },
    });
    let pending!: Promise<boolean>;
    try {
      await act(async () => {
        pending = hook.current.saveNow();
      });
      await hook.render({
        flow: flow("B", "project-B"),
        auth: { userId: "B", supabase: sb },
      });
      await act(async () => {
        gate.resolve({ data: { user: { id: "A" } } });
        await pending;
      });
      expect(await pending).toBe(false);
      expect(upsert).not.toHaveBeenCalled();
      expect(storage.clear).not.toHaveBeenCalled();
      expect(hook.current.lastSaved).toBe("");
    } finally {
      await hook.unmount();
    }
  });
  it("a completed old-account upsert cannot clear storage or update the new account's UI", async () => {
    const gate = deferred<{ error: null }>();
    const upsert = vi.fn().mockReturnValue(gate.promise);
    const sb = client(vi.fn().mockResolvedValue({ data: { user: { id: "A" } } }), upsert);
    const hook = await mountHook(useRenderedAutosave, {
      flow: flow(),
      auth: { userId: "A", supabase: sb },
    });
    let pending!: Promise<boolean>;
    try {
      await act(async () => {
        pending = hook.current.saveNow();
      });
      expect(upsert).toHaveBeenCalledTimes(1);
      await hook.render({
        flow: flow("B", "project-B"),
        auth: { userId: "B", supabase: sb },
      });
      await act(async () => {
        gate.resolve({ error: null });
        await pending;
      });
      expect(await pending).toBe(false);
      expect(storage.clear).not.toHaveBeenCalled();
      expect(storage.mirror).not.toHaveBeenCalled();
      expect(hook.current.lastSaved).toBe("");
    } finally {
      await hook.unmount();
    }
  });
  it("never writes a browser draft while authentication is unresolved", async () => {
    const hook = await mountHook(useRenderedAutosave, {
      flow: flow(),
      auth: { userId: null, supabase: null, loading: true },
    });
    try {
      expect(await hook.current.saveNow()).toBe(false);
      expect(storage.save).not.toHaveBeenCalled();
    } finally {
      await hook.unmount();
    }
  });
});
