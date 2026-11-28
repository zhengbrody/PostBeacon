import { asRecord, asRecordList, asString, clipString } from "./coerce";
import { auditDraftSafety } from "./contentSafety";
import type {
  Fact,
  OpportunityResearch,
  OutreachContact,
  OutreachStatus,
  ProductProfile,
  WorkspaceState,
} from "./types";

/**
 * Outreach: a short list of people the founder decided to contact personally.
 *
 * The agent may draft a message; it never sends one and never looks for
 * people's contact details. Every transition is decided here, by code, from
 * the founder's own commands. "Sent" and "replied" record what the founder
 * reports; PostBeacon cannot see the conversation.
 */
export const OUTREACH_LIMITS = {
  contacts: 20,
  draftBatch: 5,
  label: 80,
  url: 2048,
  need: 400,
  message: 700,
  reply: 400,
} as const;

export const OUTREACH_STATUS_LABEL: Record<OutreachStatus, string> = {
  new: "Needs a message",
  drafted: "Ready for your review",
  sent: "Sent by you",
  replied: "Replied",
  "no-reply": "No reply",
};

const STATUSES = Object.keys(OUTREACH_STATUS_LABEL) as OutreachStatus[];
const PLACEHOLDER = /\[[^\]\n]{1,40}\]|\{\{?[^}\n]{1,40}\}?\}|<(name|first ?name|handle)>/i;

/** Public http(s) link only; anything else is dropped rather than repaired. */
export function outreachUrl(raw: unknown): string | undefined {
  const value = asString(raw).trim();
  if (!value || value.length > OUTREACH_LIMITS.url) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * Why a message may not be recorded as sent. Same deterministic truth check as
 * public drafts, plus the two things specific to a personal message.
 */
export function outreachMessageIssues(
  message: string,
  facts: Fact[],
  profile: ProductProfile | null
): string[] {
  const text = message.trim();
  if (!text) return ["Write the message first."];
  const issues: string[] = [];
  if (text.length > OUTREACH_LIMITS.message)
    issues.push(`Keep it under ${OUTREACH_LIMITS.message} characters.`);
  if (PLACEHOLDER.test(text))
    issues.push("Replace the placeholder with real words before sending.");
  if (profile)
    for (const issue of auditDraftSafety({ hook: "", body: text }, facts, profile).issues)
      issues.push(issue.title);
  return [...new Set(issues)];
}

export function normalizeOutreach(raw: unknown): OutreachContact[] {
  const seen = new Set<string>();
  const contacts: OutreachContact[] = [];
  for (const item of asRecordList(raw)) {
    const id = clipString(item.id, 80).trim();
    const label = clipString(item.label, OUTREACH_LIMITS.label).trim();
    const need = clipString(item.need, OUTREACH_LIMITS.need).trim();
    const createdAt = asString(item.createdAt);
    if (!id || seen.has(id) || !label || !need || Number.isNaN(Date.parse(createdAt)))
      continue;
    seen.add(id);
    const message = clipString(item.message, OUTREACH_LIMITS.message).trim();
    const sentAt = asString(item.sentAt);
    const sent = !Number.isNaN(Date.parse(sentAt));
    let status = STATUSES.includes(item.status as OutreachStatus)
      ? (item.status as OutreachStatus)
      : "new";
    // A state the machine could not have produced is downgraded, never trusted.
    if (status !== "new" && !message) status = "new";
    if (status !== "new" && status !== "drafted" && !sent) status = "drafted";
    const url = outreachUrl(item.url);
    const reply = clipString(item.reply, OUTREACH_LIMITS.reply).trim();
    const messageSource = ["agent", "founder", "example"].includes(
      asString(item.messageSource)
    )
      ? (item.messageSource as OutreachContact["messageSource"])
      : undefined;
    contacts.push({
      id,
      revision:
        typeof item.revision === "number" && item.revision >= 0
          ? Math.floor(item.revision)
          : 0,
      label,
      ...(url ? { url } : {}),
      need,
      origin: item.origin === "research" ? "research" : "founder",
      ...(asString(item.sourceId) ? { sourceId: clipString(item.sourceId, 80) } : {}),
      status,
      ...(message ? { message, messageSource: messageSource ?? "founder" } : {}),
      ...(message && Array.isArray(item.factIds)
        ? {
            factIds: item.factIds
              .filter((f): f is string => typeof f === "string" && f.length <= 60)
              .slice(0, 6),
          }
        : {}),
      ...(status === "replied" && reply ? { reply } : {}),
      createdAt,
      updatedAt: Number.isNaN(Date.parse(asString(item.updatedAt)))
        ? createdAt
        : asString(item.updatedAt),
      ...(sent && status !== "new" && status !== "drafted" ? { sentAt } : {}),
      ...(item.example === true ? { example: true } : {}),
    });
    if (contacts.length >= OUTREACH_LIMITS.contacts) break;
  }
  return contacts;
}

/* ---------- commands ---------- */

type Bound = { contactId: string; revision: number; at: string };
export type OutreachCommand =
  | {
      type: "add";
      id: string;
      label: string;
      url?: string;
      need: string;
      origin: "founder" | "research";
      sourceId?: string;
      example?: boolean;
      at: string;
    }
  | ({ type: "remove" } & Bound)
  | ({
      type: "draft-received";
      message: string;
      factIds: string[];
      source: "agent" | "example";
    } & Bound)
  | ({ type: "edit-message"; message: string } & Bound)
  | ({ type: "mark-sent"; confirmed: boolean } & Bound)
  | ({ type: "record-reply"; reply: string } & Bound)
  | ({ type: "mark-no-reply" } & Bound);

export interface OutreachContext {
  facts: Fact[];
  profile: ProductProfile | null;
}

export type OutreachResult =
  { ok: true; next: Pick<WorkspaceState, "outreach"> } | { ok: false; refusal: string };

const refuse = (refusal: string): OutreachResult => ({ ok: false, refusal });
const STALE =
  "This contact changed since that action was started. Review it and try again.";

export function applyOutreachCommand(
  workspace: Pick<WorkspaceState, "outreach">,
  command: OutreachCommand,
  context: OutreachContext
): OutreachResult {
  const list = workspace.outreach ?? [];
  if (Number.isNaN(Date.parse(command.at))) return refuse("That action has no valid time.");

  if (command.type === "add") {
    const label = command.label.trim().slice(0, OUTREACH_LIMITS.label);
    const need = command.need.trim().slice(0, OUTREACH_LIMITS.need);
    if (!label) return refuse("Say who this is, in your own words.");
    if (need.length < 8) return refuse("Say what this person needs, in a sentence.");
    const url = outreachUrl(command.url);
    if (command.url?.trim() && !url)
      return refuse("Use a full public link starting with https://, or leave it empty.");
    if (list.length >= OUTREACH_LIMITS.contacts)
      return refuse(
        `The list holds ${OUTREACH_LIMITS.contacts} people. Remove one before adding another.`
      );
    if (list.some((c) => c.id === command.id)) return refuse(STALE);
    if (command.sourceId && list.some((c) => c.sourceId === command.sourceId))
      return refuse("That source is already on the list.");
    if (url && list.some((c) => c.url === url))
      return refuse("That link is already on the list.");
    const contact: OutreachContact = {
      id: command.id,
      revision: 0,
      label,
      ...(url ? { url } : {}),
      need,
      origin: command.origin,
      ...(command.sourceId ? { sourceId: command.sourceId } : {}),
      status: "new",
      createdAt: command.at,
      updatedAt: command.at,
      ...(command.example ? { example: true } : {}),
    };
    return { ok: true, next: { outreach: [...list, contact] } };
  }

  const current = list.find((c) => c.id === command.contactId);
  if (!current || current.revision !== command.revision) return refuse(STALE);
  const replace = (patch: Partial<OutreachContact>): OutreachResult => ({
    ok: true,
    next: {
      outreach: list.map((c) =>
        c.id === current.id
          ? { ...c, ...patch, revision: c.revision + 1, updatedAt: command.at }
          : c
      ),
    },
  });
  const editable = current.status === "new" || current.status === "drafted";

  switch (command.type) {
    case "remove":
      return { ok: true, next: { outreach: list.filter((c) => c.id !== current.id) } };
    case "draft-received":
    case "edit-message": {
      if (!editable)
        return refuse("This message was already recorded as sent. It is kept as sent.");
      const message = command.message.trim();
      if (!message) return refuse("Write the message first.");
      if (message.length > OUTREACH_LIMITS.message)
        return refuse(`Keep it under ${OUTREACH_LIMITS.message} characters.`);
      if (command.type === "edit-message")
        return replace({ message, messageSource: "founder", status: "drafted" });
      // An agent draft must not overwrite words the founder wrote meanwhile.
      if (current.messageSource === "founder")
        return refuse("You edited this message yourself, so the draft was not applied.");
      const known = new Set(context.facts.map((f) => f.id));
      return replace({
        message,
        messageSource: command.source,
        factIds: command.factIds.filter((id) => known.has(id)).slice(0, 6),
        status: "drafted",
      });
    }
    case "mark-sent": {
      if (current.status !== "drafted" || !current.message)
        return refuse("There is no reviewed message to record as sent.");
      if (!command.confirmed)
        return refuse("Confirm that you sent it yourself. PostBeacon sends nothing.");
      const issues = outreachMessageIssues(current.message, context.facts, context.profile);
      if (issues.length) return refuse(`Fix this first: ${issues[0]}`);
      return replace({ status: "sent", sentAt: command.at });
    }
    case "record-reply": {
      if (current.status !== "sent" && current.status !== "no-reply")
        return refuse("Record a reply only for a message you sent.");
      const reply = command.reply.trim().slice(0, OUTREACH_LIMITS.reply);
      if (reply.length < 3) return refuse("Say in a few words what they replied.");
      return replace({ status: "replied", reply, closedAt: command.at });
    }
    case "mark-no-reply":
      if (current.status !== "sent")
        return refuse("Only a sent message can be closed as no reply.");
      return replace({ status: "no-reply", closedAt: command.at });
  }
}

/* ---------- derived views ---------- */

export interface OutreachSummary {
  total: number;
  toReview: number; // new or drafted
  sent: number; // sent, replied or no-reply
  awaiting: number; // sent, not closed
  replied: number;
}

export function outreachSummary(list: OutreachContact[] | undefined): OutreachSummary {
  const contacts = list ?? [];
  const count = (...s: OutreachStatus[]) =>
    contacts.filter((c) => s.includes(c.status)).length;
  return {
    total: contacts.length,
    toReview: count("new", "drafted"),
    sent: count("sent", "replied", "no-reply"),
    awaiting: count("sent"),
    replied: count("replied"),
  };
}

/** Research sources with a real quote that are not on the list yet. */
export function outreachSuggestions(
  research: OpportunityResearch | undefined,
  list: OutreachContact[] | undefined
): { sourceId: string; url: string; label: string; need: string }[] {
  if (!research || research.example) return [];
  const taken = new Set((list ?? []).flatMap((c) => (c.sourceId ? [c.sourceId] : [])));
  return research.sources
    .filter(
      (source) =>
        !taken.has(source.id) &&
        (source.verification === "quote-found" ||
          source.verification === "user-provided") &&
        Boolean(outreachUrl(source.url))
    )
    .map((source) => ({
      sourceId: source.id,
      url: source.url,
      label: (source.title || new URL(source.url).hostname).slice(0, OUTREACH_LIMITS.label),
      need: source.quote.slice(0, OUTREACH_LIMITS.need),
    }));
}

/** Fictional message for the demo. Written by code; no model is called. */
export function exampleOutreachMessage(productName: string): string {
  return `Fictional example. You mentioned this problem, and I built ${productName} to help with it. Would you try it once and tell me where it was unclear?`;
}

/** What the model receives for one contact: the need only, never who or where. */
export function outreachModelInput(
  contacts: OutreachContact[]
): { alias: string; contactId: string; revision: number; need: string }[] {
  return contacts
    .filter((c) => c.status === "new" && !c.example)
    .slice(0, OUTREACH_LIMITS.draftBatch)
    .map((c, index) => ({
      alias: `c${index + 1}`,
      contactId: c.id,
      revision: c.revision,
      need: c.need,
    }));
}

export function asOutreachDrafts(
  raw: unknown
): { alias: string; message: string; factIds: string[] }[] {
  return asRecordList(asRecord(raw).messages).flatMap((item) => {
    const alias = asString(item.id).trim();
    const message = clipString(item.message, OUTREACH_LIMITS.message).trim();
    if (!/^c[1-5]$/.test(alias) || !message || PLACEHOLDER.test(message)) return [];
    return [
      {
        alias,
        message,
        factIds: Array.isArray(item.factIds)
          ? item.factIds.filter((f): f is string => typeof f === "string").slice(0, 6)
          : [],
      },
    ];
  });
}
