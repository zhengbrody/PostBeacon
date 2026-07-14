# M19 — Interactive execution workbench

## Problem

M18 made the plan action-first, but most state changes remained invisible. A founder could
mark a post published and the reducer would create an experiment, update memory, Progress
and Weekly Review, yet the screen mostly replaced one card with another. It still felt like
a report with buttons.

## Product contract

The Today surface is a four-stage workbench:

`Prepare → Publish → Measure → Learn`

Every meaningful click must produce immediate, nearby feedback. No action may silently
change another tab and expect the founder to discover it.

## Interaction rules

### Prepare / Publish

- The Next best move contains the recommended draft, not a link to another report.
- The founder can switch variants, edit, copy, open the destination and start tracking.
- Copy/edit/open actions acknowledge success in the card.
- Confirming publication returns to Today with an experiment-started receipt, a lifecycle
  card and the next result-check countdown.

### Measure / Learn

- When a check-in is due, the result form opens inside the Next best move card.
- Before a check-in is due, the founder may record a real early signal; it is labeled as
  early and never replaces the scheduled 24h/72h checks.
- Saving results replaces the form with the deterministic verdict and next actions.
- The lifecycle steps update in place; Progress and Weekly Review are projections of the
  same experiment, never separate workflows.

### Review / Progress

- Empty zero-state dashboards are replaced by the current experiment and its next event.
- Suggestions that can be acted on are buttons (record, prepare, schedule), not prose only.
- Jargon is secondary to plain language: “completed experiments” is the public label;
  “learning loop” remains the internal north-star definition.

## Safety boundaries

- Still no auto-posting. Opening a platform, copying content and recording a manual publish
  are separate explicit actions.
- Empty metrics remain absent, never coerced to zero.
- Copilot suggestions remain review-before-apply through the M16 action boundary.
- No new persistence or SQL migration: interaction state is ephemeral; durable events use
  the existing experiment/outcome/task state machine.

## Acceptance criteria

- [x] A posting action can be prepared without leaving Today.
- [x] Copy, edit, variant switch and platform-open actions visibly acknowledge the click.
- [x] Publication produces a receipt and an active-experiment countdown.
- [x] A due or early result can be recorded inline and immediately becomes a verdict.
- [x] Early manual signals remain distinct from completed scheduled experiments.
- [x] Progress visibly projects the current experiment lifecycle.
- [x] Weekly Review contains actionable empty states and scheduling/check-in controls.
- [x] Desktop and mobile preserve one dominant action and usable controls.
- [x] Existing state invariants, export, deletion, RLS and no-auto-posting behavior remain.
