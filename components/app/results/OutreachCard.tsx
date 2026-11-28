"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  OUTREACH_LIMITS,
  OUTREACH_STATUS_LABEL,
  outreachMessageIssues,
} from "@/lib/outreach";
import type { OutreachController } from "@/hooks/useOutreach";
import type { OutreachContact } from "@/lib/types";

const INPUT =
  "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-accent-500";
const LABEL = "mb-1 block text-xs font-medium text-neutral-400";

const TONE: Record<OutreachContact["status"], string> = {
  new: "border-line text-neutral-400",
  drafted: "border-amber-700/60 text-amber-300",
  sent: "border-accent-700/60 text-accent-300",
  replied: "border-emerald-700/60 text-emerald-300",
  "no-reply": "border-line text-neutral-500",
};

const newId = () =>
  `oc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();

function ContactRow({
  contact,
  controller,
}: {
  contact: OutreachContact;
  controller: OutreachController;
}) {
  const [text, setText] = useState(contact.message ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [reply, setReply] = useState("");
  const [copied, setCopied] = useState<"yes" | "blocked" | null>(null);
  const bound = { contactId: contact.id, revision: contact.revision, at: now() };
  const editable = contact.status === "new" || contact.status === "drafted";
  const dirty = text.trim() !== (contact.message ?? "");
  const issues =
    contact.message && editable
      ? outreachMessageIssues(contact.message, controller.facts, controller.profile)
      : [];
  const id = `outreach-${contact.id}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(contact.message ?? "");
      setCopied("yes");
    } catch {
      setCopied("blocked");
    }
  };

  return (
    <li className="rounded-lg border border-line/60 px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TONE[contact.status]}`}
        >
          {OUTREACH_STATUS_LABEL[contact.status]}
        </span>
        <span className="min-w-0 flex-1 break-words text-sm font-medium text-neutral-100">
          {contact.label}
        </span>
        {contact.example && (
          <span className="text-[10px] uppercase tracking-wide text-neutral-500">
            Fictional
          </span>
        )}
      </div>
      <p className="mt-1 break-words text-xs leading-relaxed text-neutral-400">
        Their need: {contact.need}
      </p>
      {contact.url && (
        <a
          href={contact.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-1 inline-block break-all text-xs font-medium text-accent-300 hover:text-accent-200"
        >
          Open where you will reply
        </a>
      )}

      {editable ? (
        <div className="mt-3">
          <label htmlFor={id} className={LABEL}>
            Your message
            {contact.messageSource === "agent" && " (drafted by the agent, edit freely)"}
          </label>
          <textarea
            id={id}
            className={INPUT}
            rows={4}
            maxLength={OUTREACH_LIMITS.message}
            value={text}
            placeholder="Write it yourself, or ask the agent to draft it."
            onChange={(e) => {
              setText(e.target.value);
              setConfirmed(false);
              setCopied(null);
            }}
          />
          {issues.length > 0 && !dirty && (
            <ul className="mt-2 space-y-1 text-xs text-amber-300" role="alert">
              {issues.map((issue) => (
                <li key={issue}>Fix before sending: {issue}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {dirty && (
              <Button
                size="sm"
                disabled={!text.trim()}
                onClick={() =>
                  controller.send({ type: "edit-message", message: text, ...bound })
                }
              >
                Save message
              </Button>
            )}
            {!dirty && contact.message && issues.length === 0 && (
              <Button size="sm" variant="outline" onClick={copy}>
                Copy message
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => controller.send({ type: "remove", ...bound })}
            >
              Remove
            </Button>
            {copied === "yes" && (
              <span className="text-xs text-emerald-300" role="status">
                Copied. Nothing was sent.
              </span>
            )}
            {copied === "blocked" && (
              <span className="text-xs text-amber-300" role="status">
                Copying was blocked. Select the text and copy it yourself.
              </span>
            )}
          </div>
          {!dirty && contact.message && issues.length === 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-neutral-300">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I sent this message myself
              </label>
              <Button
                size="sm"
                disabled={!confirmed}
                onClick={() => controller.send({ type: "mark-sent", confirmed, ...bound })}
              >
                Record as sent
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <p className="whitespace-pre-wrap break-words rounded-lg border border-line/60 bg-surface-2 px-3 py-2 text-xs leading-relaxed text-neutral-300">
            {contact.message}
          </p>
          {contact.status === "replied" && contact.reply && (
            <p className="mt-2 break-words text-xs text-emerald-300">
              What came back (your note): {contact.reply}
            </p>
          )}
          {(contact.status === "sent" || contact.status === "no-reply") && (
            <div className="mt-3">
              <label htmlFor={`${id}-reply`} className={LABEL}>
                What did they reply?
              </label>
              <input
                id={`${id}-reply`}
                className={INPUT}
                maxLength={OUTREACH_LIMITS.reply}
                value={reply}
                placeholder="In your own words. Leave empty if nothing came back."
                onChange={(e) => setReply(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={reply.trim().length < 3}
                  onClick={() => controller.send({ type: "record-reply", reply, ...bound })}
                >
                  Record reply
                </Button>
                {contact.status === "sent" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => controller.send({ type: "mark-no-reply", ...bound })}
                  >
                    No reply
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * People the founder contacts personally. The agent drafts; the founder sends.
 * Nothing here posts, messages or looks anyone up.
 */
export function OutreachCard({ controller }: { controller: OutreachController }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [need, setNeed] = useState("");
  const { contacts, summary, suggestions } = controller;
  const waiting = contacts.filter((c) => c.status === "new").length;
  const full = contacts.length >= OUTREACH_LIMITS.contacts;

  const add = () => {
    const refusal = controller.send({
      type: "add",
      id: newId(),
      label,
      url,
      need,
      origin: "founder",
      ...(controller.demo ? { example: true } : {}),
      at: now(),
    });
    if (!refusal) {
      setLabel("");
      setUrl("");
      setNeed("");
    }
  };

  return (
    <Card className="no-print mb-6 p-4 sm:p-5" id="outreach">
      <section aria-labelledby="outreach-title">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-300">
          People to contact
        </p>
        <h2 id="outreach-title" className="mt-0.5 text-sm font-semibold text-neutral-100">
          {summary.total === 0
            ? "Reach the people who already described this problem"
            : `${summary.total} on the list · ${summary.toReview} to review · ${summary.awaiting} awaiting a reply · ${summary.replied} replied`}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-neutral-400">
          Add someone who said they need this. The agent drafts a short message from your
          verified facts; you send it yourself and record what came back. PostBeacon sends
          nothing and looks nobody up. The name and link stay in your project and are not
          sent to the model.
        </p>

        {suggestions.length > 0 && !full && (
          <div className="mt-3 rounded-lg border border-line/60 px-3 py-2.5">
            <p className="text-xs font-medium text-neutral-300">
              From your research: places where someone described the need
            </p>
            <ul className="mt-2 space-y-2">
              {suggestions.slice(0, 3).map((s) => (
                <li key={s.sourceId} className="flex flex-wrap items-start gap-2">
                  <span className="min-w-0 flex-1 break-words text-xs text-neutral-400">
                    {s.label}: “{s.need}”
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      controller.send({
                        type: "add",
                        id: newId(),
                        label: s.label,
                        url: s.url,
                        need: s.need,
                        origin: "research",
                        sourceId: s.sourceId,
                        at: now(),
                      })
                    }
                  >
                    Add to list
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {contacts.length > 0 && (
          <ol className="mt-4 space-y-2" aria-label="People to contact">
            {contacts.map((contact) => (
              <ContactRow
                key={`${contact.id}:${contact.revision}`}
                contact={contact}
                controller={controller}
              />
            ))}
          </ol>
        )}

        {waiting > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={controller.drafting || !controller.canAskAgent}
              onClick={() => void controller.draft()}
            >
              {controller.drafting
                ? "Drafting…"
                : `Draft ${Math.min(waiting, OUTREACH_LIMITS.draftBatch)} message${Math.min(waiting, OUTREACH_LIMITS.draftBatch) === 1 ? "" : "s"}`}
            </Button>
            <span className="text-xs text-neutral-500">
              {controller.demo
                ? "Fictional example: no model is called."
                : controller.canAskAgent
                  ? "Uses 1 model request for the whole batch."
                  : "Sign in to have the agent draft, or write each message yourself."}
            </span>
          </div>
        )}

        {controller.message && (
          <p className="mt-3 text-xs leading-relaxed text-amber-300" role="alert">
            {controller.message}{" "}
            <button type="button" className="underline" onClick={controller.dismissMessage}>
              Dismiss
            </button>
          </p>
        )}

        {!full && (
          <details className="mt-4" open={contacts.length === 0 || undefined}>
            <summary className="cursor-pointer text-xs font-medium text-accent-300">
              Add a person
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="outreach-label" className={LABEL}>
                  Who (your own label)
                </label>
                <input
                  id="outreach-label"
                  className={INPUT}
                  maxLength={OUTREACH_LIMITS.label}
                  value={label}
                  placeholder="Founder asking in a forum thread"
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="outreach-url" className={LABEL}>
                  Public link where you will reply (optional)
                </label>
                <input
                  id="outreach-url"
                  className={INPUT}
                  inputMode="url"
                  maxLength={OUTREACH_LIMITS.url}
                  value={url}
                  placeholder="https://"
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="outreach-need" className={LABEL}>
                  What they said they need
                </label>
                <textarea
                  id="outreach-need"
                  className={INPUT}
                  rows={2}
                  maxLength={OUTREACH_LIMITS.need}
                  value={need}
                  placeholder="Their problem in a sentence. Do not paste private details."
                  onChange={(e) => setNeed(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={add}>
                Add to list
              </Button>
            </div>
          </details>
        )}
      </section>
    </Card>
  );
}
