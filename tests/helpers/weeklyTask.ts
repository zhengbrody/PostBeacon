import { vi } from "vitest";
import type { WeeklyTaskController } from "@/hooks/useWeeklyTask";

/** A controller with no task and no request in flight, for tests of other surfaces. */
export function idleWeeklyTask(
  overrides: Partial<WeeklyTaskController> = {}
): WeeklyTaskController {
  return {
    task: undefined,
    history: [],
    context: { facts: [], contextKey: "context", demo: false },
    planning: false,
    message: "",
    canAskAgent: false,
    send: vi.fn(() => null),
    plan: vi.fn(async () => undefined),
    cancelPlanning: vi.fn(),
    dismissMessage: vi.fn(),
    ...overrides,
  };
}
