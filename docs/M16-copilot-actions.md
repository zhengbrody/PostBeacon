# M16 — Copilot as an auditable CMO action engine

> Design contract, written before implementation. The Launch Copilot stops
> being a chat box that reads the plan and becomes a proposal engine: the
> model can only PROPOSE structured actions; the user confirms; the app
> applies; everything is audited. **PostBeacon still never posts for you.**

## 1. Core rule: the model never mutates state

```
model → { reply, actions: ProposedAction[] }   (strict schema, server-validated)
UI    → renders each action as a card: diff · rationale · impact · evidence
user  → Apply (→ reducer dispatches, audit "applied")
        Dismiss (→ audit "rejected")
server-invalid actions never reach the UI (audit "blocked")
```

There is no code path from a model response to a state change without an
explicit user confirmation. Destructive proposals require a second
confirmation (same two-step pattern as channel removal):

- `stop_or_continue_channel` with decision `stop`
- `update_channel_priority` that LOWERS a priority
- any `update_positioning` / angle / post change that overwrites a field the
  user has edited by hand (tracked in `memory.userEditedFields`)

## 2. The nine tools

| tool | payload (validated) | on Apply |
|---|---|---|
| ask_clarifying_question | question, why, options? | answer feeds the chat (and facts via existing flows); no state change |
| propose_next_actions | ≤3 {title, whyNow, estMinutes, platformId?} | optional per-item "add to calendar" (SCHEDULE_ITEM_ADDED) |
| update_positioning | positioning? and/or antiPositioning? | STRATEGY_PATCHED (diff shown old→new) |
| update_channel_priority | platformId, priority | RECOMMENDATION_PATCHED (downgrade = destructive) |
| create_experiment | platformId, community, angle, hypothesis, postIdx? | opens the Publish dialog PREFILLED — the experiment is only created when the user says "I published it" (no-auto-posting invariant) |
| generate_variant | platformId, direction?, hook?, body? | content present → VARIANT_ADDED directly; direction only → one rewrite call (platform persona + ANTI_AI rules), then VARIANT_ADDED |
| record_outcome | experimentId, checkpoint — **no metric fields exist in the schema**, so a model can never fabricate numbers into state | opens the Outcome panel for manual entry |
| diagnose_outcome | experimentId, diagnosis, suggestion | informational (cites the outcome data) |
| stop_or_continue_channel | platformId, decision | stop → EXPERIMENT_STOPPED for that channel's live experiments (destructive); continue → informational endorsement |

Unknown tools, unknown platform/experiment ids, and schema-invalid payloads
are dropped server-side and reported (`audit.blocked`).

## 3. Evidence contract (requirement 5)

Every action carries `rationale` + `evidence: {type, id}[]` where refs point
at real objects: facts (`fact:audience`), experiments (`exp:<id>`), channel
recommendations (`rec:<platformId>`), posts (`post:<platformId>#<idx>`),
memory entries (`mem:angle:<i>`). The server RE-VERIFIES every ref against
the actual plan (the model's own claim of being grounded is never trusted):

```
verified refs ≥ 1 → confidence "grounded"
verified refs = 0 → confidence "unknown"  (model told to say so and attach a
                    validationExperiment proposal; UI shows an "unverified —
                    treat as hypothesis" badge; destructive+unknown still
                    requires the double confirm and shows a warning)
```

## 4. Product Memory (requirement 3) — lean by construction

Stored (new `memory` state, draft v5 + projects.meta):

```
tone?             preferred writing tone (user-editable)
bannedClaims[]    things never to claim (user-editable, ≤20)
angles[]          winning/losing angle records — auto-appended when an
                  outcome verdict lands (supported/promising → winning,
                  weak / no-signal@72h → losing), each citing its experiment (≤20)
rewriteFeedback[] accepted/rejected variant summaries (NOT full text, ≤30)
userEditedFields[] which plan fields the user hand-edited (drives the
                  overwrite double-confirm)
```

Deliberately NOT stored: chat transcripts (session-only, as before),
user-confirmed facts (already the fact ledger), channel outcomes (already
workspace experiments) — the prompt references those sources directly, so
nothing is duplicated and nothing can drift.

## 5. Proactive briefings (requirement 4)

Opening the Copilot inserts a **deterministic briefing** (no model call, no
latency, can't hallucinate): today's ≤3 actions + budget, overdue check-ins,
due 24h/72h collections, weekly review (loops closed, best angle) and the
next-experiment suggestion — all computed by the existing engine
(lib/today.ts). Chips under the briefing hand specific asks to the model
("design that experiment", "why is this channel stalling").

## 6. Audit log (requirement 7)

`workspace.auditLog` (capped 100): `{id, at, tool, summary, decision:
applied|rejected|blocked, destructive, evidence: verified/total}`. Applied
entries also surface on the Timeline. Server reports blocked counts per
response; the client logs them.

## 7. Prompt-injection & authorization defenses

1. Pasted user content (feedback/questions) is delimited («…») and the system
   prompt declares it data, never instructions.
2. The action validator is the hard boundary: no unknown tools, no unknown
   ids, strict enums/caps — injected text cannot mint a valid destructive
   action against objects that don't exist.
3. Even a valid-looking injected action is only ever a CARD — the human
   confirmation gate is the design, not a mitigation.
4. record_outcome carries no metrics; verdicts stay code-computed (M15).
5. Tests cover: malicious tool names, fabricated ids, metric smuggling,
   destructive flood, delimiter wrapping, and that response processing is
   pure (zero dispatches before confirm).

## 8. Out of scope (documented)

Email/push proactivity (in-app only), cross-project memory, model-initiated
memory writes (memory changes only from user actions/verdicts), Supabase
tables for memory (meta jsonb is sufficient at this size).
