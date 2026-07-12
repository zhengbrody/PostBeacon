"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { ClarifyingQuestion, Fact, FactStatus } from "@/lib/types";
import type { ContextField } from "@/lib/facts";

/**
 * The Fact Ledger UI (M13): what we know, how we know it, and the ≤3
 * clarifying questions for what we don't. The only place "user-confirmed"
 * can be produced.
 */

const STATUS_STYLE: Record<FactStatus, { label: string; cls: string }> = {
  observed: { label: "observed on page", cls: "bg-emerald-500/15 text-emerald-300" },
  "user-confirmed": { label: "you confirmed", cls: "bg-accent-600/20 text-accent-300" },
  inferred: { label: "inferred", cls: "bg-amber-500/15 text-amber-300" },
  unknown: { label: "unknown", cls: "bg-surface-2 text-neutral-400" },
};

function StatusChip({ status }: { status: FactStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

function FactRow({
  fact,
  onConfirm,
  onCorrect,
  onDelete,
}: {
  fact: Fact;
  onConfirm: (id: string) => void;
  onCorrect: (id: string, claim: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.claim);

  if (fact.status === "unknown" && !fact.claim) return null; // questions cover these

  return (
    <li className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {fact.field && (
              <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                {fact.field}
              </span>
            )}
            <StatusChip status={fact.status} />
          </div>
          {editing ? (
            <div className="mt-1.5 flex gap-2">
              <input
                className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
              />
              <Button
                size="sm"
                onClick={() => {
                  if (draft.trim()) onCorrect(fact.id, draft);
                  setEditing(false);
                }}
              >
                Save
              </Button>
            </div>
          ) : (
            <p className="mt-1 text-sm text-neutral-100">{fact.claim}</p>
          )}
          {fact.status === "observed" && fact.evidence && !editing && (
            <p className="mt-1 truncate text-xs text-neutral-500">
              page: &ldquo;{fact.evidence}&rdquo;
            </p>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-1">
            {fact.status !== "user-confirmed" && (
              <button
                className="rounded-md px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10"
                title="Confirm this is correct"
                onClick={() => onConfirm(fact.id)}
              >
                ✓
              </button>
            )}
            <button
              className="rounded-md px-2 py-1 text-xs text-neutral-400 hover:bg-surface"
              title="Correct it"
              onClick={() => {
                setDraft(fact.claim);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button
              className="rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-red-500/10 hover:text-red-300"
              title="Remove from the ledger"
              onClick={() => onDelete(fact.id)}
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function QuestionRow({
  q,
  onAnswer,
}: {
  q: ClarifyingQuestion;
  onAnswer: (id: ContextField, answer: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <li className="rounded-lg bg-surface-2 p-3">
      <p className="text-sm font-medium text-neutral-100">{q.question}</p>
      <p className="mt-0.5 text-xs text-neutral-500">{q.why}</p>
      {q.options && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {q.options.map((opt) => (
            <button
              key={opt}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-neutral-200 hover:border-accent-500 hover:text-accent-300"
              onClick={() => onAnswer(q.id, opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <input
          className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm"
          placeholder={
            q.id === "assets"
              ? "e.g. 800 newsletter subs, 2k X followers, ~5 hrs/week"
              : "Or type your own…"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) onAnswer(q.id, text);
          }}
        />
        <Button size="sm" disabled={!text.trim()} onClick={() => onAnswer(q.id, text)}>
          Save
        </Button>
        <button
          className="shrink-0 px-2 text-xs text-neutral-500 hover:text-neutral-300"
          title="Skip — the plan will treat this as unknown instead of guessing"
          onClick={() => onAnswer(q.id, "")}
        >
          Skip
        </button>
      </div>
    </li>
  );
}

export function FactLedger({
  facts,
  questions,
  onConfirm,
  onCorrect,
  onDelete,
  onAnswer,
}: {
  facts: Fact[];
  questions: ClarifyingQuestion[];
  onConfirm: (id: string) => void;
  onCorrect: (id: string, claim: string) => void;
  onDelete: (id: string) => void;
  onAnswer: (id: ContextField, answer: string) => void;
}) {
  const visibleFacts = facts.filter((f) => !(f.status === "unknown" && !f.claim));
  if (!visibleFacts.length && !questions.length) return null;

  return (
    <>
      {questions.length > 0 && (
        <Card className="border-accent-700/50 bg-accent-600/10 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-accent-300">
            {questions.length} quick {questions.length === 1 ? "question" : "questions"}
          </h2>
          <p className="mb-3 mt-1 text-xs text-neutral-400">
            Your page doesn&apos;t say these. Answering sharpens the whole plan —
            skipping is fine, the strategy will treat them as unknown instead of guessing.
          </p>
          <ul className="space-y-2">
            {questions.map((q) => (
              <QuestionRow key={q.id} q={q} onAnswer={onAnswer} />
            ))}
          </ul>
        </Card>
      )}

      {visibleFacts.length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Fact ledger</h2>
          <p className="mb-3 mt-1 text-xs text-neutral-500">
            Every claim the plan builds on, with its provenance.{" "}
            <span className="text-emerald-300">observed</span> = quoted from your page
            (machine-checked) · <span className="text-amber-300">inferred</span> = the
            model&apos;s read — confirm ✓ or correct anything that&apos;s off.
          </p>
          <ul className="space-y-2">
            {visibleFacts.map((f) => (
              <FactRow
                key={f.id}
                fact={f}
                onConfirm={onConfirm}
                onCorrect={onCorrect}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
