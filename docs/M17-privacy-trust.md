# M17 — Privacy & trust foundation

> Engineering implementation + **draft copy for legal review**. Nothing in this
> document or in the generated pages is legal advice; every statement that needs
> a lawyer's sign-off is collected in [Open questions for counsel](#open-questions-for-counsel).
> Single code source: `lib/privacy.ts` (inventory, subprocessors, provider notes)
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
│  API routes (analyze/strategy/generate/regenerate/copilot/usage/billing/     │
│  account/retention) · server logs (platform-managed) · Vercel Web Analytics  │
│  (cookieless, aggregated page views)                                         │
└──┬───────────────┬──────────────────┬──────────────────┬────────────────┬────┘
   │               │                  │                  │                │
   ▼               ▼                  ▼                  ▼                ▼
 SUPABASE       LLM PROVIDER       FIRECRAWL          TAVILY            POLAR
 (accounts,     (selected per      (only if           (only if         (only if
  projects,      run: Anthropic /   SCRAPE_API_KEY:    SEARCH_API_KEY:  billing on:
  entitlements,  OpenAI /           the product URL    profile-derived  checkout,
  workspace      DeepSeek —         for headless       search queries)  merchant of
  tables,        prompt = page      rendering)                          record)
  webhook ids)   text + profile +
                 edits + pasted
                 feedback)
```

Two hard product invariants shape everything below:

- **No auto-posting** — PostBeacon never holds social-platform credentials and
  never publishes on the user's behalf. There is no posting tool in the copilot
  schema (M16).
- **The page the user pastes is the data source.** We only fetch URLs the user
  (or a validated search hit) supplies, through `lib/safeFetch.ts` (M12 SSRF
  policy), and treat fetched text as data, never instructions.

## 2. Data inventory

Legal-basis column is a **suggestion for counsel** (GDPR framing), not a
determination. "Region" is the primary processing region per the subprocessor's
public docs — counsel must confirm transfer mechanisms (SCCs/DPF) per contract.

| # | Category | Contents | Purpose | Suggested legal basis | Retention | Region | Deletion path | Subprocessors |
|---|----------|----------|---------|----------------------|-----------|--------|---------------|---------------|
| 1 | Anonymous draft | url, profile, facts, strategy, generated posts, workspace (experiments/outcomes incl. metrics the user typed), product memory | Resume work without an account | Not personal data processing by us (stays on device); disclose anyway | Until the user clears it (Clear local draft / browser data) | User's device only | **Clear local draft** button; browser storage clear | none |
| 2 | Account identity | email, OAuth identity (Google `sub`), display name | Sign-in, project ownership | Contract (account provision) | Life of account | Supabase project region (currently unset in prod; when enabled: chosen at project creation) | **Delete account** (removes auth user) | Supabase; Google (only if user picks Google sign-in) |
| 3 | Product URL + scraped page text | The URL pasted, extracted page text/title | Build the product profile | Contract | Transient on server (request lifetime); persisted only as part of the plan the user saves | Vercel (US) → chosen LLM | Delete project / delete account / clear draft | Vercel, LLM provider, Firecrawl (render fallback only) |
| 4 | Product profile + fact ledger | name, audience, tone, pricing, stage, goals, user corrections/confirmations | Score platforms, generate content | Contract | With the project | Supabase (signed in) / device (anon) | Delete project / account / draft | Supabase, LLM provider |
| 5 | Generated plan + content | strategy, scores, posts, calendar, playbooks | The product's output | Contract | With the project | same as 4 | same as 4 | Supabase, LLM provider (as prompt context on follow-up calls) |
| 6 | Workspace + outcomes | experiments (platform, community, angle, tracked URL), outcomes (impressions/replies/clicks/signups/revenue, qualitative feedback), tasks, audit log | The learning loop (M15/M16) | Contract | With the project | same as 4 | Delete project cascades campaigns→experiments→outcomes→tasks (FKs); delete account removes all | Supabase, LLM provider (compact context) |
| 7 | Product memory | tone, banned claims, angle verdicts, rewrite accept/reject summaries | Personalize copilot output | Contract | With the project (in `projects.meta`) | same as 4 | same as 4 (rides the project row) | Supabase, LLM provider |
| 8 | Pasted feedback / copilot chat | free text the user sends the copilot, incl. "I'm pasting feedback" content | Answer the user's question | Contract | **Not stored by us** (transcripts are session-only by design, M16); provider retains per its API policy | Vercel → LLM provider | n/a on our side; provider-side per provider policy | LLM provider |
| 9 | Entitlements / usage | plan, launches used, calls today | Metering, abuse control | Contract + legitimate interest (abuse prevention) | Life of account | Supabase | Delete account | Supabase |
| 10 | Billing | checkout + subscription events (Polar is merchant of record; we never see card numbers) | Payment | Contract; legal obligation (tax/accounting on Polar's side) | Our webhook ledger: event **ids only**; Polar retains transaction records per law | Polar (EU/US) | webhook ids swept by retention task; Polar records governed by Polar ToS — counsel to confirm | Polar |
| 11 | Webhook event ids | Polar event id + received-at (idempotency only — no payload stored) | Replay protection | Legitimate interest (security) | Retention task (operator-configured) | Supabase | Retention sweep | Supabase |
| 12 | Server logs / analytics | Platform request logs (IP, UA, path) managed by Vercel; Vercel Web Analytics (cookieless, aggregated) | Ops, security, aggregate traffic | Legitimate interest | Vercel platform defaults (~ short-lived); we add **no** application logging of user content — enforced by ESLint `no-console` + `lib/log.ts` redaction for the few allowed error lines | Vercel (US) | Ages out per Vercel retention | Vercel |

**What we never collect:** social-platform credentials, card numbers (Polar is
merchant of record), analytics cookies, cross-site trackers, chat transcripts as
long-term memory.

## 3. Subprocessors (rendered at /subprocessors from `lib/privacy.ts`)

| Vendor | Role | Data it sees | Region | Always on? |
|--------|------|--------------|--------|------------|
| Vercel | Hosting, serverless functions, cookieless web analytics | All request traffic; aggregated page views | US | Yes |
| Supabase | Auth + database | Account identity, projects, workspace, entitlements | Project region (operator-chosen) | Only when accounts are configured |
| Anthropic | LLM (Claude) | Prompt: page text, profile, plan context, pasted feedback | US | Only when selected for a run |
| OpenAI | LLM (GPT) | same as Anthropic | US | Only when selected for a run |
| DeepSeek | LLM | same as Anthropic | China | Only when selected for a run |
| Firecrawl | Headless rendering of SPA product pages | The product URL being analyzed | US | Only if SCRAPE_API_KEY set and static fetch came back empty |
| Tavily | Web search for community discovery | Search queries derived from the product profile (not the raw page) | US | Only if SEARCH_API_KEY set |
| Polar | Merchant of record (checkout, tax, invoices) | Purchase identity + transaction data (their side) | EU/US | Only when billing is configured |
| Google | OAuth sign-in option | OAuth handshake only | US | Only if the user chooses "Continue with Google" |

## 4. AI-provider data handling (rendered next to the model picker)

Statements below reflect each provider's **published API policy as of
2026-07-12 and must be re-verified by counsel** before being treated as
contractual:

| Provider | API data used for training? | Stated API retention | Region | Product stance |
|----------|----------------------------|----------------------|--------|----------------|
| Anthropic (Claude) | Not by default for API traffic | Bounded (abuse monitoring window) | US | OK as default |
| OpenAI | Not by default for API traffic | Up to ~30 days (abuse monitoring) | US | OK as default |
| DeepSeek | **Not clearly excluded** in public API terms | Unclear; data processed/stored in China | China | **Never the code default.** Selectable, but labeled with a caution; users told not to paste confidential material when it's active |

Enforcement in code (`lib/llm.ts` + `lib/privacy.ts`):
`availableProviders()` orders clear-policy providers first. `DEFAULT_PROVIDER`
may choose among configured clear-policy providers, but cannot silently put an
unclear-policy provider ahead of one. DeepSeek remains available for explicit
per-run selection (and remains usable when it is the only configured provider),
with a caution beside the picker.

## 5. Threat model

Assets, in priority order: (A1) unreleased product ideas — page text, profile,
strategy (confidentiality is the pitch: founders paste pre-launch products),
(A2) account identity (email/OAuth), (A3) experiment metrics incl. revenue
numbers the user types, (A4) operator API keys, (A5) billing state.

| Threat | Vector | Mitigation (exists) | Residual risk / follow-up |
|--------|--------|--------------------|---------------------------|
| SSRF / internal-network pivot | Attacker-supplied URL | `lib/urlPolicy.ts` + `lib/safeFetch.ts` (M12): scheme/port/IP-range allowlist, connect-time DNS pinning, per-hop redirect revalidation, size/time caps | Low; covered by 60+ tests |
| Cross-user data access | Forged/absent auth | Supabase RLS owner-only on every user table; server verifies bearer via GoTrue; service role never in client code; one-shot audit reports missing tables/policies as FAIL | Production audit verified all seven checks PASS on 2026-07-13; rerun after future schema migrations |
| Prompt injection via scraped page or pasted feedback | Malicious page text / comment paste | Page text treated as data; facts require verified quotes (M13); copilot input delimited «…» and declared data; action validator refuses minted verbs/fabricated ids; human confirm is the only state bridge (M16) | Model may still be *influenced* in tone; injection cannot reach state |
| LLM provider retains/trains on confidential ideas | Normal API use | Provider notes at the picker; an unclear-policy provider cannot silently outrank a configured clear-policy provider; no chat transcript storage on our side | User can still explicitly select an unclear-policy provider; counsel must review the disclosure and regional availability |
| Secrets/PII in logs | App logging, error paths | **Zero `console.*` in app code today**, now locked in by ESLint `no-console`; the two allowed sinks route through `lib/log.ts` which strips query strings, emails, bearer/JWT/`sk-` tokens and truncates | Vercel platform request logs still record IP/path — disclosed |
| Token theft via URL params | Careless link building | No user data in query strings (policy + review); magic-link/OAuth tokens are handled by Supabase in fragments, `detectSessionInUrl` consumes them | — |
| Shared/stolen device reads the anonymous draft | localStorage | Disclosed honestly (FAQ + privacy page); **Clear local draft** control on the input step | localStorage is by-design unencrypted; users warned |
| Webhook forgery / replay | Polar endpoint | HMAC + timestamp window + id idempotency; fails closed without secret (M12) | — |
| Stale data outliving its use | No lifecycle | **Retention task** `/api/retention` (CRON_SECRET-gated, RETENTION_DAYS-configured, off by default) sweeping inactive projects + webhook ids; account/project deletion cascades | Enabling retention must be reflected on /privacy — the page reads the same env, so it self-updates |
| Deletion that doesn't actually delete | Partial cleanup | Service-role-only `delete_postbeacon_user_data` RPC deletes all six data tables in one DB transaction, then `auth.admin.deleteUser`; pre-migration installs use the tested explicit fallback | Auth deletion is outside the DB transaction; if it fails, data is gone but the login record remains for operator cleanup. Provider backups age out separately |
| Cross-user aggregation / training on user content | Product temptation | **Not done, and stated as a commitment**: no cross-user training or aggregation by default. Any future anonymized-outcomes moat requires a separate, explicit, revocable opt-in + de-identification + minimum-cohort threshold (k ≥ 20) before anything is computed | Contract terms must reserve the right ONLY under that opt-in — drafted, needs counsel |

## 6. Data-rights implementation

| Right | Surface | Mechanism |
|-------|---------|-----------|
| Clear local draft | Input step (anon) | `clearDraft()` + flow reset — wipes the single localStorage slot |
| Export account data | Project bar → Data & privacy | `GET /api/account/export` (bearer) — RLS-scoped read of projects, campaigns, experiments, outcomes, tasks, entitlement + identity; downloads as JSON. Works with anon key only (no service role needed) |
| Delete account | Project bar → Data & privacy (type-DELETE confirm) | `POST /api/account/delete` (bearer + literal confirm string): transactional RPC wipes all six user tables, then `auth.admin.deleteUser`. Requires service role; **fails closed (503)** when the deployment can't do it — never pretends |
| Retention | Operator | `GET/POST /api/retention`: 503 without CRON_SECRET, 401 on wrong secret, `{enabled:false}` no-op without RETENTION_DAYS/service role; else deletes projects with `updated_at < now-days` (cascades) + old webhook ids. `vercel.json` cron wired daily; Vercel injects `Authorization: Bearer $CRON_SECRET` automatically |

## 7. Open questions for counsel

1. **Entity + contact**: legal entity name, registered address, and a monitored
   privacy contact email. Legal pages use `NEXT_PUBLIC_PRIVACY_EMAIL` when set
   and otherwise fall back to the GitHub feedback link; set the env only after
   inbound delivery has been tested.
2. **Governing law / venue** for the Terms (placeholders marked `[COUNSEL]`).
3. **GDPR posture**: are we targeting EU users (site is English, founder-tool)?
   If yes: confirm legal bases per inventory row, Art. 28 DPAs with every
   subprocessor, transfer mechanism per vendor (DPF/SCCs), whether an EU/UK
   representative is required, and a DPIA for the DeepSeek/China flow.
4. **DeepSeek**: is offering a China-processed LLM on user product data
   acceptable with the caution-label approach, or must it be opt-in per run /
   removed for EU users? Verify current DeepSeek API terms on training use.
5. **US state laws (CPRA etc.)**: confirm we are outside "sale/share"
   definitions (no ad tech; cookieless analytics) and whether a "Do Not
   Sell/Share" link is nonetheless required.
6. **Retention vs. legal holds**: Polar (merchant of record) holds transaction
   records — confirm we may fully delete our side (entitlements, webhook ids)
   on account deletion, and what to say about backup persistence windows.
7. **Terms substance**: AI-output disclaimer (no guarantee of accuracy or
   results; user reviews before posting), beta/as-is warranty disclaimer,
   liability cap, acceptable use (only analyze URLs you have the right to
   analyze), IP position (user owns inputs; we assign/waive our interest in
   generated outputs to the extent permitted), termination, age minimum (16?
   18?), export-control boilerplate.
8. **Sign-in clickwrap**: is the "By continuing you agree…" line at the auth
   screen sufficient assent for these Terms?
9. **Cookie banner**: we set no marketing cookies (Supabase auth uses
   localStorage; Vercel Analytics is cookieless) — confirm no consent banner is
   required in target markets.
10. **Future outcomes-data opt-in** (§5 last row): review the reserved-rights
    clause draft — separate consent, revocable, de-identified, k-anonymity
    threshold — before any such feature ships.

## 8. Acceptance criteria

- /privacy, /terms, /subprocessors render from `lib/privacy.ts`, are linked in
  the footer, in the sitemap, and marked "draft pending legal review".
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
