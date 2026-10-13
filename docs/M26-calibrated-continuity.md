# M26 A/B — calibrated learning and continuous experiments

2026-10-11. This milestone implements roadmap stages **A and B locally**. It is not
an autonomous Growth Agent, a production deployment, or proof of real-user retention.

## Product behavior

- Measure separates observed values, blank/not measured and explicitly unavailable.
  “No response” sets only replies to zero and still requires review/save; it never
  fabricates exposure, clicks, registrations or revenue.
- GitHub, Reddit and Product Hunt have relevant observation fields. A named custom
  numeric signal is supported. The published primary signal remains first.
- Verdict owns an assessment: target reached, directional improvement, early,
  target missed, insufficient or invalidated. Removed posts, broken tracking, wrong
  audience and major external events are recorded without becoming failures.
- 72h observations remain cumulative. The UI subtracts a measured 24h value only
  when both values are known; a negative delta asks the user to verify the source.
- Final-window, valid Outcome reads supply angle memory. One execution contributes
  at most one read. Distinct comparable executions can show early/repeated/conflicting
  evidence; this is not statistical confidence or proof of causality. Comparable
  means matching channel, venue, angle, success definition and published product context.
  Legacy threshold reads stay in history, not new winning/losing memory.
- Search URL membership is enforced before liveness probes. Search-backed, reachable,
  page content read and rules reviewed are different facts. This discovery path does
  not read/review community content/rules. Fictional demo links do not claim a search receipt.
- Share Kit defaults to **promoting the user's product**; process-sharing is optional.
  It preserves full source copy, applies the existing deterministic Truth Gate, and
  blocks unsafe/missing entry points and overlong X segments. It provides screenshot
  instructions/alt text/privacy reminders, not manufactured screenshot attachments.

## Repeatable interaction

`Record → inspect learning receipt → choose hook/venue/pause → confirm queue → prepare
draft → review/edit → manual publish → next checkpoint`

The queue records an independent template ID, planned ID, source execution/Outcome and
execution ID. Confirming does not call the model or publish. Preparing appends a draft;
publishing consumes the ready entry atomically. A cancelled entry rejects late generated
responses. Duplicate confirmations/preparation/publish cannot create a second execution.
Same-channel follow-ups use a new draft index and execution ID, not a platform “done” flag.

Publish freezes draft, facts, audience, voice and success definition. Queued Hook tests
preserve the source body in code. On publishing, a deterministic comparison checks the
actual held conditions; edits to body/context/rule/venue/angle downgrade the run to
exploratory. Venue adaptations that also change copy are exploratory, not fake controlled
tests. External conditions and publication timing are never claimed controlled.

Copilot repairs/rewrites bind platform, draft index and original hook/body. Diffs use that
source text. Stale proposals cannot Apply; rejecting leaves the original unchanged.
The deterministic gate still runs on the resulting draft. This is optimistic draft-version
checking, not a new general-purpose background Agent job system.

## Persistence and privacy

Schema v10 rides the existing owner-scoped `projects.meta.workspace` JSON and local draft
slot. That JSON is authoritative for the full queue, observations and publish snapshots.
The normalized mirrors remain best-effort lifecycle tables; this milestone does not add
separate SQL columns for all new signals/snapshots/queue entries. Do not reconstruct a full
project from those mirrors. Project/account JSON export includes the canonical workspace;
Markdown also exposes queue, snapshots and measurement availability/invalidation.

No SQL migration, env variable, vendor, auto-posting integration or billing change is
required. Existing project/account deletion and inactive-project retention cover these
fields with their parent project. No cross-user content memory is created.

Aggregate health reads only a bounded assessment label from existing `outcomes.verdict`,
in addition to keys/timestamps. Unknown/invalid evidence does not inflate completed loops.
Lifecycle events emit the first qualifying scheduled read once; historical event counts
cannot be retracted on later invalidation, while the operator report recomputes eligibility.

Bounds: 40 planned entries per project and 12 drafts per channel, with explicit capacity
messages; recent Copilot context is 30 executions and six observations each, without
deleting persisted history. Full request size limits remain fail-closed. Prepared source
execution is explicitly included in the recent context. Longer autonomous runs, resumable
jobs, per-step budgets and connectors belong to roadmap C–E, not this implementation.

## Verification / release boundary

- Offline suites cover unknown vs zero, unavailable/invalidation, final-window memory,
  repeated/conflicting evidence, 72h deltas, source membership, product Share Kit,
  stale repair, queue idempotency, late-response cancellation, publish snapshots,
  history hydration, account reset and portable exports.
- Desktop 1440×1000 and mobile 375×812 fictional walkthroughs exercised initial
  publish → example result → confirmed follow-up → prepared draft → second publish →
  unavailable manual measurement/learning receipt. No model requests or horizontal
  overflow were observed. Development-mode runs had no browser warnings/errors;
  local production-mode runs reported a missing Vercel Analytics script (404/MIME),
  since the local server does not host Vercel's `/_vercel/insights` endpoint. That
  deployment-specific asset still needs verification on Vercel; it is not an app
  flow failure or a clean production-browser acceptance claim.
- Browser walkthrough deliberately makes no real provider calls, database writes or
  external posts. Reload persistence is covered by deterministic JSON hydration tests,
  not claimed as a new production account/browser acceptance.
- Before release: deploy these changes, then verify a disposable signed-in project can
  save, reload, export, queue a second experiment, and delete itself. Do not erase a real
  user's account for acceptance. Production provider credits, DB state and email delivery
  have not been rechecked by this local milestone.

## Next milestone

C: user-provided sources first, bounded opportunity research with source excerpts and
unknown-rule labels; prepare one real product trial kit and let the user confirm it into
this queue. Then D adds actual product activation/feedback imports, weekly Start/Continue/
Stop and versioned re-analysis. E adds explicitly approved read-only connectors and MCP
only after real second-loop/return behavior is demonstrated.
