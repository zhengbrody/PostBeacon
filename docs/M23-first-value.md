# M23 — First value before the full workspace

## Product decision

Stage one changes the acquisition promise from “generate a large launch report” to a
smaller, testable outcome:

> verified product facts → one best-fit channel → one truth-checked draft → manual
> publish → measured result → next experiment

The full 19-platform strategy still exists for signed-in projects, but it is no longer the
first thing the landing page promises or the first result a guest has to understand.

## Signed-out preview

`POST /api/preview` accepts only a bounded public URL and returns only:

- a minimal product summary;
- the canonical source URL and hostname so the result cannot drift from the current input;
- one highest-ranked non-fallback channel and its rationale;
- one draft that passes the same deterministic truth gate used by the workspace;
- actual provider/model provenance for analysis, scoring, and content.

It does not return the fact ledger, all rankings, a schedule, a playbook, Copilot, or a
saved project. It does not write the URL, page text, draft, IP, user agent, or fingerprint
to Supabase or the quota store.

### Abuse and spend boundary

The route is unavailable unless every required control is configured. Before scraping or
calling a model it performs:

1. same-origin request validation;
2. feature/provider/privacy configuration checks;
3. a 4 KB zod request-body boundary and the normal URL/SSRF syntax policy;
4. a signed random visitor identity, returned even when later quota/model work fails;
5. a server-enforced DeepSeek acknowledgement when that provider may receive the page;
6. an atomic Upstash Redis Lua reservation for both the visitor token digest and a
   shared global window.

The default policy is one preview per visitor per 24 hours and 25 previews globally per 24
hours. A quota-store/configuration failure returns 503; exhaustion returns 429 with
`Retry-After`. There is no in-memory or cookie-only production fallback. Clearing the
visitor cookie cannot bypass the global hard cap. A malicious client can still reject every
cookie and consume the shared allowance, so the public launch should also use the host's
WAF/bot controls; the global cap protects spend even in that case.

Required activation variables:

```env
GUEST_PREVIEW_ENABLED=true
GUEST_PREVIEW_SIGNING_SECRET=<at least 32 random bytes>
UPSTASH_REDIS_REST_URL=<credential-free HTTPS endpoint>
UPSTASH_REDIS_REST_TOKEN=<server-only token>
```

DeepSeek is excluded unless `GUEST_PREVIEW_ALLOW_DEEPSEEK=true`; this is independent of
the signed-in fallback switch. When eligible, `/api/providers` returns the real routing and
warning contract, the browser requires an explicit acknowledgement, and `/api/preview`
enforces that acknowledgement again before quota/model work. Limit/window variables are
documented in `.env.example`.

The browser offers **Stop waiting** and aborts its wait after 90 seconds. Because quota is
reserved before external work and an aborted browser request may already be executing, the
UI states honestly that a stopped attempt can still consume the allowance.

## Explicit account handoff

A successful guest result is kept in a dedicated localStorage record for at most one hour.
It is deliberately separate from the normal autosave draft and is not a partial project.

Clicking Google or requesting a magic link adds a random, 30-minute, one-time nonce to the
stored preview and the callback URL. Only a matching callback can consume it; an unrelated
already-signed-in account never loads a leftover preview. After a matching same-browser OAuth
or magic-link return, the signed-in user sees an explicit offer:

- **Continue with this URL** restores only the URL into the authenticated flow;
- the full analysis runs only after the user submits it;
- **Discard preview** removes the handoff;
- a successful authenticated project write clears the in-memory handoff;
- sign-out or a real user A → user B transition clears it;
- an ordinary login never silently imports or assigns it to an account.

If localStorage is unavailable, the preview stays visible in the current tab and the UI
warns that refresh/sign-in may lose it.

## Three-minute fictional walkthrough

The baked-in Cronwise plan now has a controlled Prepare → Publish → Measure → Learn guide.
The guide projects the real temporary workspace state:

- Prepare reveals the evidence-backed draft;
- Publish opens the normal confirmation in explicit simulation mode;
- Measure records a labelled example 24h result and lets the reducer compute the verdict;
- Learn opens the real review projection and its next recommended experiment.

The walkthrough never calls a model, never posts, and never autosaves. Regenerate, Copilot,
and live generation paths show a local explanation instead of making a request. Reloading
`?demo=1` restores the canonical empty example workspace.

## Public copy and privacy

Landing metadata, OG copy, Hero, How it works, platform section, FAQ, Footer, and hidden
pricing copy now use the same evidence/experiment/learning-loop position. Public privacy
data is deployment-aware:

- local-only full drafts appear only when accounts are not configured;
- guest-preview browser storage, quota identity, and Upstash appear only when the complete
  preview boundary is configured;
- provider retry and no-auto-posting statements remain shared with the actual runtime.

## Acceptance boundary

- Guest preview is one channel and one safe draft only.
- Quota/config failures occur before scrape/model calls.
- Demo has no live model or persistence path.
- Guest data is never silently assigned to an arriving account, and only the matching
  one-time authentication callback may reveal the handoff.
- Every visible claim matches the configured deployment.
- Desktop, 375 px, keyboard, API error, and reload behavior are browser-verified before
  activation.
