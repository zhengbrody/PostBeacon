import { vi } from "vitest";
import type { WeeklyTaskController } from "@/hooks/useWeeklyTask";
import type { OutreachController } from "@/hooks/useOutreach";

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

/** An empty outreach list with no request in flight. */
export function idleOutreach(
  overrides: Partial<OutreachController> = {}
): OutreachController {
  return {
    contacts: [],
    summary: { total: 0, toReview: 0, sent: 0, awaiting: 0, replied: 0 },
    suggestions: [],
    facts: [],
    profile: null,
    demo: false,
    drafting: false,
    message: "",
    canAskAgent: false,
    send: vi.fn(() => null),
    draft: vi.fn(async () => undefined),
    dismissMessage: vi.fn(),
    ...overrides,
  };
}
