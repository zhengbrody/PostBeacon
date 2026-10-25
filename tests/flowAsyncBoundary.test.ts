// @vitest-environment jsdom
import { act } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useLaunchFlow } from "@/hooks/useLaunchFlow";
import { DEMO_PROJECT } from "@/lib/demo";
import { deferred, mountHook } from "./helpers/reactHook";
const requests = vi.hoisted(() => ({ analyze: vi.fn(), providers: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: requests }));
vi.mock("@/lib/storage", () => ({ loadDraft: () => null, clearDraft: vi.fn() }));
vi.mock("@/lib/productAnalytics", () => ({
  PRODUCT_EVENTS: { analysisCompleted: "analysis" },
  trackProductEvent: vi.fn(),
}));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  requests.providers.mockResolvedValue({ providers: ["openai"] });
});
afterEach(() => vi.unstubAllGlobals());
const answer = (name: string) => ({
  profile: { ...DEMO_PROJECT.profile, name },
  facts: [],
  questions: [],
  meta: { provider: "openai", model: "test" },
});
describe("real flow Hook ignores stale work", () => {
  it("analyze from account A cannot populate account B after reset", async () => {
    const gate = deferred<ReturnType<typeof answer>>();
    requests.analyze.mockReturnValue(gate.promise);
    const hook = await mountHook<string, ReturnType<typeof useLaunchFlow>>(
      (id) => useLaunchFlow(id),
      "A"
    );
    let pending!: Promise<boolean>;
    try {
      await act(async () => hook.current.setUrl("https://example.org"));
      await act(async () => {
        pending = hook.current.analyze();
      });
      await hook.render("B");
      await act(async () => hook.current.resetAccountBoundary());
      await act(async () => {
        gate.resolve(answer("A private result"));
        await pending;
      });
      expect(await pending).toBe(false);
      expect(hook.current.profile).toBeNull();
      expect(hook.current.loading).toBe(false);
      expect(requests.analyze.mock.calls[0][3].aborted).toBe(true);
    } finally {
      await hook.unmount();
    }
  });
  it("loading another project cannot be overwritten by an earlier analysis", async () => {
    const gate = deferred<ReturnType<typeof answer>>();
    requests.analyze.mockReturnValue(gate.promise);
    const hook = await mountHook(() => useLaunchFlow("A"), undefined);
    let pending!: Promise<boolean>;
    try {
      await act(async () => hook.current.setUrl("https://example.org"));
      await act(async () => {
        pending = hook.current.analyze();
      });
      await act(async () => hook.current.loadDemo());
      await act(async () => {
        gate.resolve(answer("Old result"));
        await pending;
      });
      expect(hook.current.profile?.name).toBe(DEMO_PROJECT.profile.name);
      expect(hook.current.demo).toBe(true);
    } finally {
      await hook.unmount();
    }
  });
  it("old failures cannot clear loading or show errors for the newer request", async () => {
    const first = deferred<ReturnType<typeof answer>>(),
      second = deferred<ReturnType<typeof answer>>();
    requests.analyze.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const hook = await mountHook(() => useLaunchFlow("A"), undefined);
    let old!: Promise<boolean>, next!: Promise<boolean>;
    try {
      await act(async () => hook.current.setUrl("https://first.example"));
      await act(async () => {
        old = hook.current.analyze();
      });
      await act(async () => hook.current.setUrl("https://second.example"));
      await act(async () => {
        next = hook.current.analyze();
      });
      await act(async () => {
        first.reject(new Error("old error"));
        await old;
      });
      expect(hook.current.error).toBe("");
      expect(hook.current.loading).toBe(true);
      await act(async () => {
        second.resolve(answer("Current result"));
        await next;
      });
      expect(hook.current.profile?.name).toBe("Current result");
      expect(hook.current.loading).toBe(false);
    } finally {
      await hook.unmount();
    }
  });
});
