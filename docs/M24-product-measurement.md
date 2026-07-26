# M24 — Guest-preview acceptance and privacy-safe product measurement

## Decisions

PostBeacon needs evidence that the first-value promise and the learning loop work, but it
does not need another user-event database or access to the user's content. Measurement is
therefore split into two narrow layers:

1. **Cookieless aggregate funnel events** in Vercel Web Analytics. The single client helper
   accepts only a fixed event list plus provider, checkpoint, mode, and handoff-source enums.
   URLs, page text, product names, drafts, emails, account ids, qualitative feedback, and
   outcome numbers are structurally dropped.
2. **Operator-only lifecycle counts** from the normalized Supabase mirrors already required
   by the workspace. `GET /api/metrics` uses the existing service role behind
   `CRON_SECRET`, reads only user keys and timestamps needed to deduplicate/count, discards
   them before the response, and returns no content or outcome values. It creates no table.

The Vercel funnel is:

`Guest Preview Started → Guest Preview Completed → Guest Handoff Accepted → Analysis
Completed → Strategy Completed → Plan Generated → Manual Publish Confirmed → Outcome
Recorded → Learning Loop Completed`.

`Guest Preview Failed` is a failure counter. A manual early result emits `Outcome Recorded`
but does not emit `Learning Loop Completed`; only scheduled 24h/72h results count toward the
retention north star.

## Aggregate metric definitions

- **Saved-project users**: distinct owners with at least one project.
- **Generated-plan users**: distinct owners with a project whose generated result exists.
- **Published users**: distinct owners with at least one normalized experiment.
- **Measured users**: distinct owners with at least one outcome.
- **Completed-loop users**: distinct owners with an analyzed experiment and a non-manual
  outcome.
- **Weekly active**: an owner with a project/campaign update, publish, outcome, or task action
  in the half-open seven-day window `[from, to)`.
- **Weekly retained**: active in both the previous and current seven-day windows.
- **Weekly retention**: retained users divided by previous-window active users. It is `null`
  when there is no baseline; fewer than 10 previous users is explicitly labelled
  `directional`, not statistically reliable.
- **Weekly completed loops**: unique analyzed experiments with a non-manual outcome recorded
  in the window.

The endpoint response states its privacy properties and never includes raw keys. Pagination
fails rather than silently truncating at the Supabase row limit.

## Operator check

Use the same production `CRON_SECRET` already used for retention. Do not paste it into a
browser URL, screenshot, log, or support message.

```bash
curl -sS https://postbeacon.app/api/metrics \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected public/failure behavior:

- no configured secret: `503`;
- absent or wrong bearer: `401`;
- no service role: `503`;
- successful request: `200`, `Cache-Control: no-store`, aggregate counts only.

## Production guest-preview acceptance — 2026-07-25

Using a fresh cookie jar against `https://postbeacon.app/api/preview` and the public
MindMarket page:

- first same-origin request returned `200` and a one-channel result in about 60 seconds;
- the result chose one channel, included actual OpenAI provenance, and the draft passed the
  deterministic truth gate;
- response was `no-store`; the visitor cookie was Secure, HttpOnly, SameSite=Lax, and had
  the configured 30-day maximum age;
- a second request with the same visitor cookie returned `429` in under one second with a
  `Retry-After` header, proving the persistent reservation blocked another model call;
- missing required DeepSeek acknowledgement returned `400` before quota/model work;
- a cross-origin request returned `403` before quota/model work.

This acceptance consumed one visitor reservation and one unit of the global daily preview
budget. The explicit one-time auth handoff remains covered by the deterministic handoff
suite and the earlier desktop/mobile browser acceptance; no signed-in account state was
mutated for this production API check.
