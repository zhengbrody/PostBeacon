import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GET as remindersRoute } from "@/app/api/reminders/route";
import { reminderCandidates, runReminderSweep, sendReminderEmail } from "@/lib/reminders";

const NOW = new Date("2026-07-13T16:00:00Z"); // Monday
const hoursBefore = (hours: number) =>
  new Date(NOW.getTime() - hours * 3_600_000).toISOString();

function project(experiment: Record<string, unknown>, email = true) {
  return {
    name: "Acme",
    meta: {
      workspace: {
        reminderPreferences: {
          email,
          timezone: "UTC",
          updatedAt: NOW.toISOString(),
        },
        experiments: [experiment],
      },
    },
  };
}

function experiment(hours: number, outcomes: Record<string, unknown>[] = []) {
  return {
    id: "exp-1",
    platformName: "Reddit",
    status: "live",
    publishedAt: hoursBefore(hours),
    outcomes,
  };
}

function req(auth?: string): NextRequest {
  return new Request("http://localhost/api/reminders", {
    headers: auth ? { authorization: auth } : {},
  }) as unknown as NextRequest;
}

const ENV_KEYS = [
  "CRON_SECRET",
  "NEXT_PUBLIC_EMAIL_REMINDERS_ENABLED",
  "RESEND_API_KEY",
  "REMINDER_FROM_EMAIL",
] as const;
const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

describe("event reminder derivation", () => {
  it("is strictly opt-in", () => {
    expect(reminderCandidates(project(experiment(25), false), NOW)).toEqual([]);
  });

  it("emits the 24h event and suppresses it once recorded", () => {
    expect(reminderCandidates(project(experiment(25)), NOW)[0]?.type).toBe("24h");
    expect(
      reminderCandidates(project(experiment(25, [{ checkpoint: "24h" }])), NOW).some(
        (reminder) => reminder.type === "24h"
      )
    ).toBe(false);
  });

  it("uses one useful 72h event instead of sending stale 24h and 72h together", () => {
    const reminders = reminderCandidates(project(experiment(80)), NOW);
    expect(reminders.map((reminder) => reminder.type)).toEqual(["72h"]);
  });

  it("prepares one timezone-aware weekly review when no result check is due", () => {
    const reminders = reminderCandidates(project(experiment(2)), NOW);
    expect(reminders.map((reminder) => reminder.type)).toEqual(["weekly"]);
    expect(reminders[0].key).toBe("weekly:2026-07-13");
  });
});

describe("/api/reminders fails closed", () => {
  it("returns 503 without a cron secret and 401 for the wrong bearer", async () => {
    delete process.env.CRON_SECRET;
    expect((await remindersRoute(req("Bearer any"))).status).toBe(503);
    process.env.CRON_SECRET = "secret";
    expect((await remindersRoute(req("Bearer wrong"))).status).toBe(401);
  });

  it("reports disabled when authenticated but delivery is not fully configured", async () => {
    process.env.CRON_SECRET = "secret";
    delete process.env.RESEND_API_KEY;
    const response = await remindersRoute(req("Bearer secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
  });
});

describe("Resend request", () => {
  it("uses plain text, a server key, and the event idempotency key", async () => {
    process.env.RESEND_API_KEY = "server-secret";
    process.env.REMINDER_FROM_EMAIL = "PostBeacon <reminders@postbeacon.app>";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendReminderEmail(
      "founder@example.com",
      {
        key: "e1:24h",
        type: "24h",
        subject: "Result due",
        text: "Record the signal.",
      },
      "postbeacon/project/e1:24h"
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer server-secret",
      "Idempotency-Key": "postbeacon/project/e1:24h",
    });
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(["founder@example.com"]);
    expect(body.text).toContain("Turn them off");
  });
});

describe("reminder sweep", () => {
  it("records successful delivery in tasks and does not send it twice", async () => {
    const taskRows: Record<string, unknown>[] = [];
    const projects = [
      {
        id: "project-1",
        user_id: "user-1",
        ...project(experiment(25)),
      },
    ];
    const campaigns = [{ id: "campaign-1", user_id: "user-1", project_id: "project-1" }];
    const client = {
      from: (table: string) => ({
        select: () =>
          table === "tasks"
            ? {
                like: () => ({
                  limit: async () => ({ data: taskRows, error: null }),
                }),
              }
            : {
                limit: async () => ({
                  data: table === "projects" ? projects : campaigns,
                  error: null,
                }),
              },
        upsert: async (row: Record<string, unknown>) => {
          taskRows.push(row);
          return { error: null };
        },
      }),
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: "founder@example.com" } },
            error: null,
          }),
        },
      },
    } as unknown as SupabaseClient;
    const send = vi.fn().mockResolvedValue(undefined);

    expect((await runReminderSweep(client, NOW, send)).sent).toBe(1);
    expect(send).toHaveBeenCalledWith(
      "founder@example.com",
      expect.objectContaining({ type: "24h" }),
      "postbeacon/project-1/exp-1:24h"
    );
    expect(taskRows[0]).toMatchObject({
      campaign_id: "campaign-1",
      id: "reminder:exp-1:24h",
      kind: "email-reminder",
    });

    send.mockClear();
    expect((await runReminderSweep(client, NOW, send)).sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
