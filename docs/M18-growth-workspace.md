# M18 — From launch report to growth workspace

## Product decision

PostBeacon serves one founder across two moments, not two competing personas:

1. **Launch mode** — the founder does not know how to get the first post out.
2. **Growth mode** — after the first measured publish, the founder needs a repeatable
   experiment → result → verdict → next experiment loop.

The mode changes automatically when the first experiment is created. There is no mode
picker and no second onboarding flow.

## Core promise

> Open PostBeacon and know the single best growth move to make next, why it matters now,
> and what the product learned from the last move.

The report is evidence and reference material. It is not the home or the success event.

## Experience hierarchy

1. One **Next best move** card with one primary action.
2. A contextual Copilot entry point scoped to that move.
3. Due result check-ins before new publishing work.
4. Other valid moves collapsed as alternatives, never equal-weight cards above the fold.
5. Strategy Library, Progress and Weekly Review as secondary surfaces.

## Activation and retention

- Activation: plan generated → first post marked published → first outcome produces a verdict.
- Mode transition: first publish switches Launch mode to Growth mode.
- North star: weekly completed learning loops, not reports or drafts generated.
- Return triggers: 24h result due, 72h result due, weekly review ready.

## Goal contract

The strategy cannot run without one primary goal. The founder may choose a fixed goal,
keep a goal observed from the page, or use a deterministic stage-based recommendation.
“Help me decide” produces a real goal; it is not passed downstream as vague prompt text.

## Reminders

In-app due states are always on. Email is a separate explicit opt-in and must be event-based
(24h, 72h, weekly review), useful, deduplicated in PostBeacon and with the provider's
idempotency key, and disableable from the workspace. Until sending infrastructure is
configured and verified, the product must not claim that email reminders are active.

## MCP later

MCP/connectors are a future evidence-ingestion layer (analytics, billing, product usage), not
the core value. Start read-only, scope every permission, show what was read, require user
confirmation before derived metrics enter an outcome, and retain the M16 audit boundary.
No auto-posting or external writes are introduced.

## Acceptance criteria

- [x] A generated plan opens on an action-first workspace, not a report.
- [x] Launch/Growth mode is derived and visible; no manual mode selector.
- [x] Exactly one primary action is visually dominant.
- [x] Up to two alternatives remain available behind progressive disclosure.
- [x] The primary action can open Copilot with that action already in context.
- [x] Strategy cannot run without a concrete primary goal.
- [x] The report surface is named Strategy Library.
- [x] Existing publish, 24h/72h outcome, verdict, timeline, review and audit behavior remains intact.
- [x] Persisted pre-M18 projects migrate without losing workspace or memory.
- [x] Offline tests cover mode, priority, goal recommendation and persistence migration.
