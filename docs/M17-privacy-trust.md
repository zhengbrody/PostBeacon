# M17 — Privacy & trust foundation

> Engineering implementation + factual private-beta data behavior. Paid-service,
> company-entity and jurisdiction decisions are intentionally out of scope until
> PostBeacon prepares for public launch or monetization. Single code source:
> `lib/privacy.ts` (inventory, configured data vendors, provider notes)
> — the /privacy, /terms and /subprocessors pages render from it, so the public
> claims can't drift from what the code actually does.

## 1. Data flow map

```
                                  ┌────────────────────────────────────────────┐
                                  │                YOUR BROWSER                │
                                  │  localStorage draft (anonymous users):     │
                                  │  url, profile, facts, strategy, content,   │
                                  │  workspace, product memory  — device only  │
                                  └───────┬────────────────────────────────────┘
                                          │ HTTPS (plan JSON, bearer token when signed in)
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        POSTBEACON on VERCEL (US)                             │
│  API routes (analyze/strategy/generate/regenerate/copilot/usage/account/     │
│  retention) · server logs (platform-managed) · cookieless web analytics      │
└──┬───────────────────┬────────────────────┬──────────────────┬───────────────┘
   │                   │                    │                  │
   ▼                   ▼                    ▼                  ▼
 SUPABASE          LLM PROVIDER         FIRECRAWL           TAVILY
 (accounts,        (OpenAI primary;     (only if            (only if
  projects,         DeepSeek selected/   SCRAPE_API_KEY       SEARCH_API_KEY:
  entitlements,     disclosed fallback;  and a plain fetch    profile-derived
  workspace)        prompt = page text +  is insufficient)    search queries)
                    profile + edits +
                    pasted feedback)
```

Two hard product invariants shape everything below:

- **No auto-posting** — PostBeacon never holds social-platform credentials and
  never publishes on the user's behalf. There is no posting tool in the copilot
  schema (M16).
- **The page the user pastes is the data source.** We only fetch URLs the user
  (or a validated search hit) supplies, through `lib/safeFetch.ts` (M12 SSRF
  policy), and treat fetched text as data, never instructions.

## 2. Data inventory

This table describes current private-beta behavior, not dormant integrations.

| Category | Purpose | Stored where / how long | Delete | Active vendors |
|----------|---------|-------------------------|--------|----------------|
| Anonymous draft | Resume without an account | Browser localStorage until cleared | Clear local draft / browser data | none |
| Account identity | Sign-in and row ownership | Supabase for the life of the account | Delete account | Supabase; Google only when chosen |
| Product URL + page text | Build the product profile | Transient request data; saved only inside a project | Delete project/account/draft | Vercel, selected LLM; Firecrawl only if configured and needed |
| Profile, facts, strategy and generated content | Build and retain the launch plan | Browser for anonymous use; owner-only Supabase row when signed in | Delete project/account/draft | Supabase, selected/fallback LLM |
| Workspace, experiments, outcomes and product memory | Publish → measure → learn loop | With the project; inactive signed-in projects are retained for the configured window | Project deletion cascades; delete account | Supabase, LLM when used as prompt context |
| Copilot input / pasted feedback | Answer the current request | Session only in PostBeacon; provider retention follows its API policy | Session ends automatically; provider-side policy applies | selected/fallback LLM |
| Usage counters | Private-beta limits and abuse control | Supabase for the account lifetime | Delete account | Supabase |
| Server logs and aggregate analytics | Reliability and security | Vercel platform defaults; application logs exclude user content | Ages out automatically | Vercel |

**What we never collect:** social-platform credentials, payment-card data,
advertising cookies, cross-site trackers, or chat transcripts as long-term memory.
Billing code exists in the repository but is not configured and is excluded from
the current public inventory and data-vendor page.

## 3. Active data vendors (rendered at /subprocessors from `lib/privacy.ts`)

| Vendor | Role | Data it sees | Region | Always on? |
|--------|------|--------------|--------|------------|
| Vercel | Hosting, serverless functions, cookieless web analytics | All request traffic; aggregated page views | US | Yes |
| Supabase | Auth + database | Account identity, projects, workspace, entitlements | Project region (operator-chosen) | Only when accounts are configured |
| OpenAI | Primary LLM | Page text, profile, plan context, pasted feedback | US | Configured in production |
| DeepSeek | Selectable/fallback LLM | Same prompt content as OpenAI | China | Configured; fallback is publicly disclosed |
| Google | OAuth sign-in option | OAuth handshake only | US | Only if the user chooses "Continue with Google" |

`activeSubprocessors()` filters this public page from real deployment
configuration. Dormant Anthropic, Firecrawl, Tavily and Polar integrations do
not appear unless their required environment configuration is present.

## 4. AI-provider data handling (rendered next to the model picker)

Statements below reflect each provider's published API policy as of 2026-07-12
and must be re-verified before changing the production provider configuration:

| Provider | API data used for training? | Stated API retention | Region | Product stance |
|----------|----------------------------|----------------------|--------|----------------|
| OpenAI | Not by default for API traffic | Up to ~30 days (abuse monitoring) | US | OK as default |
| DeepSeek | **Not clearly excluded** in public API terms | Unclear; data processed/stored in China | China | **Never the code default.** Selectable and eligible for fallback only under a public beta operator opt-in; every call surface labels the China/training uncertainty |

Enforcement in code (`lib/llm.ts` + `lib/privacy.ts`):
`availableProviders()` orders clear-policy providers first. `DEFAULT_PROVIDER`
may choose among configured clear-policy providers, but cannot silently put an
unclear-policy provider ahead of one. DeepSeek remains available for explicit
per-run selection (and remains usable when it is the only configured provider),
with a caution beside the picker. `NEXT_PUBLIC_DEEPSEEK_FALLBACK=true` is an
explicit operator beta opt-in that also changes the pre-call and legal-page
disclosures; without it, DeepSeek cannot receive an automatic retry. On a retryable provider failure (auth/credit,
rate limit, timeout/network, 5xx, or unusable structured output), `llm.ts` may
retry with another configured eligible provider and records `fallbackFrom` in
output provenance. HTTP 400/content-policy rejection does not fail over. The UI
discloses the active fallback policy before submission and reports which
provider actually completed the call.

## 5. Threat model

Assets, in priority order: (A1) unreleased product ideas — page text, profile,
strategy (confidentiality is the pitch: founders paste pre-launch products),
(A2) account identity (email/OAuth), (A3) experiment metrics the user types,
(A4) operator API keys.

| Threat | Vector | Mitigation (exists) | Residual risk / follow-up |
|--------|--------|--------------------|---------------------------|
| SSRF / internal-network pivot | Attacker-supplied URL | `lib/urlPolicy.ts` + `lib/safeFetch.ts` (M12): scheme/port/IP-range allowlist, connect-time DNS pinning, per-hop redirect revalidation, size/time caps | Low; covered by 60+ tests |
| Cross-user data access | Forged/absent auth or account switch on one browser | Supabase RLS owner-only on every user table; server verifies bearer via GoTrue; service role never in client code; one-shot audit reports missing tables/policies as FAIL; user A → sign-out/user B clears the in-memory plan and local draft before B can see it | The original seven boundary checks passed in production on 2026-07-13. The audit now also verifies the 11-column project-save contract; run the M17.6 repair and confirm all eight checks after future schema migrations. Keep the client-boundary transition test. |
| Prompt injection via scraped page or pasted feedback | Malicious page text / comment paste | Page text treated as data; facts require verified quotes (M13); copilot input delimited «…» and declared data; action validator refuses minted verbs/fabricated ids; human confirm is the only state bridge (M16) | Model may still be *influenced* in tone; injection cannot reach state |
| LLM provider retains/trains on confidential ideas | Normal API use | Provider notes at the picker; DeepSeek fallback requires a public beta opt-in and explicit China/training-uncertainty warning; actual provider + fallback provenance are surfaced; no chat transcript storage on our side | A failed primary may already have received the prompt before the retry, so two providers can process one request; beta fallback can send the retry to DeepSeek |
| Secrets/PII in logs | App logging, error paths | **Zero `console.*` in app code today**, now locked in by ESLint `no-console`; the two allowed sinks route through `lib/log.ts` which strips query strings, emails, bearer/JWT/`sk-`/`re_` tokens and truncates | Vercel platform request logs still record IP/path — disclosed |
| Unwanted reminder email / duplicate sends | Cron delivery or a retry after provider failure | Email reminders are explicit per-project opt-in; the complete delivery path fails closed unless Resend, service role, sender, public flag and cron secret are configured; deterministic reminder task ids deduplicate successful sends; every email says where to turn reminders off | A provider success followed by a rare ledger-write failure can retry the email on the next cron; monitor before enabling outside beta |
| Token theft via URL params | Careless link building | No user data in query strings (policy + review); magic-link/OAuth tokens are handled by Supabase in fragments, `detectSessionInUrl` consumes them | — |
| Shared/stolen device reads the anonymous draft | localStorage | Disclosed honestly (FAQ + privacy page); **Clear local draft** control on the input step | localStorage is by-design unencrypted; users warned |
| Stale data outliving its use | No lifecycle | **Retention task** `/api/retention` (CRON_SECRET-gated, RETENTION_DAYS-configured, off by default) sweeping inactive projects + webhook ids; account/project deletion cascades | Enabling retention must be reflected on /privacy — the page reads the same env, so it self-updates |
| Deletion that doesn't actually delete | Partial cleanup | Service-role-only `delete_postbeacon_user_data` RPC deletes all six data tables in one DB transaction, then `auth.admin.deleteUser`; pre-migration installs use the tested explicit fallback | Auth deletion is outside the DB transaction; if it fails, data is gone but the login record remains for operator cleanup. Provider backups age out separately |
| Cross-user aggregation / training on user content | Product temptation | **Not done, and stated as a commitment**: no cross-user training or aggregation by default. Any future anonymized-outcomes moat requires a separate, explicit, revocable opt-in + de-identification + minimum-cohort threshold (k ≥ 20) before anything is computed | Feature remains blocked until an explicit opt-in design is implemented and reviewed |

## 6. Data-rights implementation

| Right | Surface | Mechanism |
|-------|---------|-----------|
| Clear local draft | Input step (anon) | `clearDraft()` + flow reset — wipes the single localStorage slot |
| Export account data | Project bar → Data & privacy | `GET /api/account/export` (bearer) — RLS-scoped read of projects, campaigns, experiments, outcomes, tasks, entitlement + identity; downloads as JSON. Works with anon key only (no service role needed) |
| Delete account | Project bar → Data & privacy (type-DELETE confirm) | `POST /api/account/delete` (bearer + literal confirm string): transactional RPC wipes all six user tables, then `auth.admin.deleteUser`. Requires service role; **fails closed (503)** when the deployment can't do it — never pretends |
| Retention | Operator | `GET /api/retention`: 503 without CRON_SECRET, 401 on wrong secret, `{enabled:false}` no-op without RETENTION_DAYS/service role; else deletes projects with `updated_at < now-days` (cascades) + old webhook ids. `vercel.json` cron wired daily; Vercel injects `Authorization: Bearer $CRON_SECRET` automatically |

## 7. Private-beta scope

- There is no paid service, public-launch entity claim, governing-law choice or
  liability-cap claim on the current pages. Those decisions are deferred until
  they become real product requirements.
- The current pages stay focused on verifiable behavior: what data is stored,
  which configured vendors receive it, provider-region warnings, retention,
  export and deletion.
- `privacy@postbeacon.app` is live and its forwarding path passed an external
  inbound delivery test on 2026-07-13.
- Before any public/paid launch, create a new review milestone based on the
  actual target markets, entity and billing design rather than placeholders.

## 8. Acceptance criteria

- /privacy, /terms, /subprocessors render from `lib/privacy.ts`, are linked in
  the footer and sitemap, and state the current private-beta posture.
- FAQ contains no false claims (BYOK removed; localStorage persistence stated;
  provider list includes DeepSeek; "profile + feedback go to the selected AI
  provider" stated).
- Contextual notices: URL input (page fetched + sent to selected model),
  sign-in (Terms/Privacy assent line), copilot feedback toggle (paste goes to
  the provider), model picker (per-provider data note + /privacy link).
- Clear-draft, export, delete-project (confirm), delete-account (typed confirm,
  fail-closed) all reachable in the UI and covered by tests.
- Retention endpoint: secret-gated, env-configured, off by default, cron wired.
- ESLint `no-console` on; `lib/log.ts` redaction unit-tested (emails, query
  strings, JWTs, `sk-` keys, length cap).
- All gates green; AGENTS.md/CLAUDE.md synced.
