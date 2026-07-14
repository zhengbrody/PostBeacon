import type { SupabaseClient } from "@supabase/supabase-js";
import { asRecord, asRecordList, clipString } from "./coerce";
import { fetchWithTimeout } from "./fetch";

const HOUR = 3_600_000;
const PROJECT_LIMIT = 200;
const SEND_LIMIT = 50;
const oneLine = (value: unknown, max: number) =>
  clipString(value, max).replace(/\s+/g, " ");

export type ReminderEventType = "24h" | "72h" | "weekly";

export interface ReminderCandidate {
  key: string;
  type: ReminderEventType;
  subject: string;
  text: string;
}

export interface ReminderProject {
  id: string;
  userId: string;
  name: string;
  meta: unknown;
}

export interface ReminderSweepResult {
  enabled: boolean;
  projectsConsidered?: number;
  candidates?: number;
  sent?: number;
}

export function reminderDeliveryConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_EMAIL_REMINDERS_ENABLED === "true" &&
    process.env.RESEND_API_KEY &&
    process.env.REMINDER_FROM_EMAIL
  );
}

function zonedDate(now: Date, timezone: string): { weekday: string; date: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value ?? "";
    return {
      weekday: part("weekday"),
      date: `${part("year")}-${part("month")}-${part("day")}`,
    };
  } catch {
    return { weekday: "", date: now.toISOString().slice(0, 10) };
  }
}

/** Pure, privacy-bounded derivation from one saved project. */
export function reminderCandidates(
  project: Pick<ReminderProject, "name" | "meta">,
  now: Date
): ReminderCandidate[] {
  const meta = asRecord(project.meta);
  const workspace = asRecord(meta.workspace);
  const preferences = asRecord(workspace.reminderPreferences);
  if (preferences.email !== true) return [];

  const timezone = clipString(preferences.timezone, 80) || "UTC";
  const projectName = oneLine(project.name, 100) || "your project";
  const experiments = asRecordList(workspace.experiments);
  const candidates: ReminderCandidate[] = [];

  for (const experiment of experiments) {
    if (experiment.status === "stopped") continue;
    const id = clipString(experiment.id, 100);
    const publishedAt = new Date(clipString(experiment.publishedAt, 50));
    if (!id || Number.isNaN(publishedAt.getTime())) continue;

    const checkpoints = new Set(
      asRecordList(experiment.outcomes).map((outcome) => clipString(outcome.checkpoint, 10))
    );
    const age = now.getTime() - publishedAt.getTime();
    const platform = oneLine(experiment.platformName, 80) || "your post";

    // Once 72h is due, one useful reminder replaces a stale 24h reminder.
    if (age >= 72 * HOUR && !checkpoints.has("72h")) {
      candidates.push({
        key: `${id}:72h`,
        type: "72h",
        subject: `72h results are ready to review · ${projectName}`,
        text: `Your ${platform} experiment has reached 72 hours. Record what happened so PostBeacon can decide whether to continue, change the angle, or stop the channel.`,
      });
    } else if (age >= 24 * HOUR && !checkpoints.has("24h")) {
      candidates.push({
        key: `${id}:24h`,
        type: "24h",
        subject: `Your first result check is due · ${projectName}`,
        text: `Your ${platform} experiment has reached 24 hours. Record the early signal; missing metrics can stay blank.`,
      });
    }
  }

  const local = zonedDate(now, timezone);
  if (candidates.length === 0 && experiments.length > 0 && local.weekday === "Mon") {
    candidates.push({
      key: `weekly:${local.date}`,
      type: "weekly",
      subject: `Your weekly growth review is ready · ${projectName}`,
      text: `Open PostBeacon to see which experiments closed a learning loop, what worked, and the single best move for this week.`,
    });
  }

  return candidates;
}

export async function sendReminderEmail(
  to: string,
  reminder: ReminderCandidate,
  idempotencyKey: string
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("Reminder email delivery is not configured.");
  const site = (process.env.SITE_URL || "https://postbeacon.app")
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");
  const response = await fetchWithTimeout(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: reminder.subject,
        text: `${reminder.text}\n\nOpen your workspace: ${site}/app\n\nYou enabled event reminders in PostBeacon. Turn them off from the workspace at any time.`,
      }),
    },
    10_000
  );
  if (!response.ok) throw new Error(`Reminder provider returned ${response.status}.`);
}

/**
 * Daily cron runner. Existing `tasks` rows are the delivery ledger, so reminder
 * history is already covered by RLS, export, retention and account deletion.
 */
export async function runReminderSweep(
  sb: SupabaseClient,
  now: Date = new Date(),
  send: (
    to: string,
    reminder: ReminderCandidate,
    idempotencyKey: string
  ) => Promise<void> = sendReminderEmail
): Promise<ReminderSweepResult> {
  const [projectsResult, campaignsResult, tasksResult] = await Promise.all([
    sb.from("projects").select("id,user_id,name,meta").limit(PROJECT_LIMIT),
    sb.from("campaigns").select("id,user_id,project_id").limit(PROJECT_LIMIT),
    sb.from("tasks").select("campaign_id,id").like("id", "reminder:%").limit(5000),
  ]);
  if (projectsResult.error || campaignsResult.error || tasksResult.error) {
    throw new Error("Reminder data query failed.");
  }

  const campaigns = new Map(
    asRecordList(campaignsResult.data).map((row) => [
      clipString(row.project_id, 100),
      clipString(row.id, 100),
    ])
  );
  const delivered = new Set(
    asRecordList(tasksResult.data).map(
      (row) => `${clipString(row.campaign_id, 100)}:${clipString(row.id, 180)}`
    )
  );
  const emailCache = new Map<string, string>();
  let candidatesSeen = 0;
  let sent = 0;

  for (const row of asRecordList(projectsResult.data)) {
    if (sent >= SEND_LIMIT) break;
    const project: ReminderProject = {
      id: clipString(row.id, 100),
      userId: clipString(row.user_id, 100),
      name: clipString(row.name, 100),
      meta: row.meta,
    };
    const campaignId = campaigns.get(project.id);
    if (!project.id || !project.userId || !campaignId) continue;
    const candidates = reminderCandidates(project, now);
    candidatesSeen += candidates.length;
    if (!candidates.length) continue;

    let email = emailCache.get(project.userId);
    if (!email) {
      const { data, error } = await sb.auth.admin.getUserById(project.userId);
      if (error || !data.user?.email) continue;
      email = data.user.email;
      emailCache.set(project.userId, email);
    }

    for (const reminder of candidates) {
      if (sent >= SEND_LIMIT) break;
      const taskId = `reminder:${reminder.key}`;
      if (delivered.has(`${campaignId}:${taskId}`)) continue;
      await send(email, reminder, `postbeacon/${project.id}/${reminder.key}`);
      const { error } = await sb.from("tasks").upsert(
        {
          campaign_id: campaignId,
          id: taskId,
          user_id: project.userId,
          kind: "email-reminder",
          title: reminder.subject,
          status: "done",
          est_minutes: 0,
          acted_at: now.toISOString(),
        },
        { onConflict: "campaign_id,id" }
      );
      if (error) throw new Error("Reminder delivery ledger write failed.");
      delivered.add(`${campaignId}:${taskId}`);
      sent += 1;
    }
  }

  return {
    enabled: true,
    projectsConsidered: asRecordList(projectsResult.data).length,
    candidates: candidatesSeen,
    sent,
  };
}
