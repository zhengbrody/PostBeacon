# M26 release acceptance — A/B + C.1

2026-10-12 (America/Los_Angeles). This is a release gate, **not a completed production
acceptance**. The user authorized commit/push/production deployment after the smoke
test with “smoke test后执行”. This release includes the accumulated A/B + C.1 work;
new SQL migrations, background jobs and account deletion are outside that authorization.

## Repeatable signed-out smoke

```bash
npm run release:smoke -- http://localhost:3100
npm run release:smoke -- https://postbeacon.app
```

`scripts/release-smoke.mjs` uses Node's native fetch; no package/vendor/environment
change or API key is needed. Targets must be credential-free PostBeacon/Vercel HTTPS
origins or local HTTP origins. It never sends a bearer token, cookies, a source excerpt,
an account identity, a model prompt or a deletion request. Redirects are not followed;
requests have a ten-second deadline; notice inspection is bounded to 200 KB. Page
bodies/upstream error details/response headers are not printed. Exit 0 means only that
these public smoke checks passed; exit 1 means at least one check failed; exit 2 means
the target/arguments were invalid and no checks were sent.

Every report contains `productionAccepted: false`, an unverified deployment-revision
label and the still-required authenticated checks. It deliberately cannot promote
a mock, a 200 HTML shell or a disabled route into a full production acceptance.

## Observed production state

Direct public checks at **2026-10-13T00:58:19.898Z** (Oct 12 local time) returned:

| Check | Expected | Observed | Result |
| --- | --- | --- | --- |
| `/app` | 200 | 200 | PASS — page shell only |
| `/privacy` trial-research notice | 200 + new notice | 200, notice absent | FAIL |
| Signed-out `/api/opportunities` | 401 | 404 | FAIL — new route unavailable |
| Cross-origin `/api/opportunities` | 403 | 404 | FAIL — new route unavailable |
| Signed-out account export | 401 | 401 | PASS — auth gate only |
| Public metrics access | 401 or disabled 503 | 401 | PASS — closed to public |

`smokePassed: false`, `productionAccepted: false`. No source/model work, project
creation, account deletion, email, social post or authenticated production access
was performed. The deployed Git revision was **not** independently verified. The
observations are consistent with C.1 not being deployed; the existing page does not
prove that the new feature is live.

### Authorized release and post-deployment smoke

The user subsequently authorized release after smoke. Local smoke passed again at
**2026-10-13T01:13:33.444Z**. App revision
`93bae90cdd2780dd33da30565f0da7d3ac35d41c` was committed and pushed to `main`.
[GitHub CI run 38331172722](https://github.com/zhengbrody/PostBeacon/actions/runs/38331172722)
passed every gate, and the commit's Vercel status reported
[deployment complete](https://vercel.com/zhengbrodys-projects/postbeacon/2wbyMFsJ8wprfXFHiWKhhWoYDkuM).
The local Vercel CLI credential was expired; the existing Git integration deployed
the pushed revision without any credential, environment or permission change.

Post-deployment public smoke at **2026-10-13T01:15:48.902Z** on
`https://postbeacon.app` passed **all six checks**: `/app` 200; new trial notice present;
unsigned research 401; foreign-origin research 403; export 401; metrics 401.
The earlier 404/old-notice failures above are retained as pre-release evidence,
not the current result. `productionAccepted` remains **false** because the smoke
does not verify authenticated models, persistence, accounts or real activation.

Online fictional browser QA verified opportunity load → kit review → both required
acknowledgements → ready queue/second draft → publish-dialog cancel (queue retained)
→ simulated publish (queue consumed, independent experiment and Measure card created).
The example explicitly remained unsaved and made no source/model calls or real posts.
Browser-reported viewports were **643×848** and **341×738**, not the requested
375×812 override; neither had horizontal overflow. No browser warnings/errors were
captured. The viewport override was reset after testing. This is responsive
fictional production-assets QA, **not** a signed-in real-product acceptance.
Screenshots are local artifacts under `artifacts/release-93bae90/` and are not uploaded
as release source. Unrelated `.claude/`, `artifacts/` and `tmp/` files were not committed.

Still required: real OpenAI and explicitly chosen DeepSeek runs; a dedicated QA
project's save/refresh/export; two-account isolation; failure handling; genuine
trial feedback and repeat-experiment retention. C.2 and new SQL remain out of scope.
CI passed with runner/action-runtime deprecation notices; these are a follow-up
maintenance item, not failing gates or evidence that production acceptance is complete.

## Release sequence

1. Confirm commit/push/production-deployment scope. Include A/B and C.1 app/lib/hooks,
   tests and delivery documents; do not include unrelated `.claude`, artifacts or
   temporary files merely because they share the worktree. Preserve all existing work.
2. Run typecheck, offline tests, lint, formatting and production build on the exact
   release candidate. Record its commit and successful deployment URL/revision.
3. Rerun the signed-out smoke on that deployment. A missing route, old privacy notice,
   unexpected redirect, keyless 503 research or network error stops acceptance.
4. Desktop/mobile fictional walkthroughs verify interaction without model calls.
   They do not substitute for a signed-in real product test.
5. Use a **dedicated beta QA project**, not a founder's existing launch history. Use
   one authentic, authorized public demand excerpt; remove identities and private data.
   The tester must really perform the trial steps and review actual venue rules.
6. Explicitly test one OpenAI request and one separately selected/disclosed DeepSeek
   request. Record actual provider/quote status, not only the requested provider. No
   default fallback or Claude call is allowed on this research path. Bound the test
   to the intended requests; do not repeatedly generate until a flattering result appears.
7. Review gate failures, deliberate form/context edits and repeated confirmation. A
   blocked/inadequate model invitation is a legitimate output; do not bypass the gate
   to produce a green test. Confirm a safe kit once; verify queue/draft counts.
8. Save, refresh and export; compare trial audience, source quote/status, entry/steps,
   selected draft and Success Contract. Sign out and use a second approved QA account
   to verify isolation. Deleting the dedicated QA project must not delete other projects.
   Any whole-account deletion needs separate, explicit confirmation of the QA account.
9. Record manual publication only for a post that was actually published. If no social
   post is in scope, validate this path in the fictional walkthrough and label the real
   publish/Measure/activation checks **not run**, never fabricate metrics or timestamps.
10. A provider outage/auth/quota-failure path needs an isolated local fixture or a
    separately approved preview configuration; do not break a production API key to test it.

No SQL migration is needed for A/B + C.1. C.2's durable jobs/atomic budget schema is
**not part of this release**. Source-research receipts are still finished project JSON,
not resumable AgentRun jobs. Real activation/feedback and repeated-use retention
require a genuine user study after technical acceptance; a smoke report cannot prove them.

## Validation of the checker

Eight offline tests cover target restrictions, no credentials/identity/deletion,
404/503/redirect rejection, actual privacy-notice presence, bounded body reads and
redacted network failure. They assert that even a passing smoke is not full production
acceptance. These are checker unit tests, not the missing production feature's acceptance.

The built local app passed all six smoke checks at **2026-10-13T01:03:19.780Z**
using `http://localhost:3100`. Local metrics returned 503 (disabled but closed), not
proof of a configured report. A separate `127.0.0.1` run returned 403 for the nominal
same-origin research probe: Next's local request origin uses `localhost` in this
configuration. Use the canonical local origin; do not loosen the route's origin check
to make an alias pass. Neither local run constitutes production acceptance.

Final candidate gates: **505 offline tests passed, two live tests skipped**; typecheck,
lint, formatting, production build and diff whitespace checks passed. No live model
test or new authenticated desktop/mobile production walkthrough was run in this step.

## October 23 continuation

See [bounded provider acceptance and recovery corrections](M26.C1-provider-acceptance.md).
The public production smoke was rechecked successfully. A single real OpenAI call
used a controlled, explicitly hypothetical scenario and the local C.1 orchestrator;
it did not complete authenticated production, real-demand or retention acceptance.
Recovery regression tests exposed and fixed goal-provenance restamping and loss of
the source-truncation warning. C.2 remains a separate, unimplemented milestone.

## October 24 security/account-boundary release candidate

The user explicitly authorized production release **after acceptance** in the current
turn. Scope is the accumulated async/account/export corrections and dependency migration,
plus the bounded Review correctness repair below. No SQL, environment variables, provider
models, real account deletion or social publication is authorized by this release.

Browser QA exposed a real inconsistency: a 72h-contract experiment with a positive
24h checkpoint was already shown as the "best angle", although final-window Memory
correctly excluded it. A failing regression reproduced this. Weekly Review and Copilot
now read angle candidates from `deriveAngleEvidence`, exclude conflicting evidence,
and label a qualifying candidate "Target-reaching angle" with its existing evidence
grade. Channel summaries explicitly say "strongest checkpoint", not an angle win.
Completed scheduled learning-loop counts are unchanged; no persisted state/schema
or invented confidence score was added. Final-window, repeated and conflicting cases
are covered by regressions.

Local candidate checks:

- 569 offline tests pass; three live tests skipped. Typecheck, lint, formatting and
  production build pass under Node 22.23.4. Dependency scans have zero known advisories.
- Built-app browser QA observed actual **1440×1000** desktop and **375×812** mobile
  viewports, with no horizontal document overflow or captured warnings/errors.
- The fictional tutorial passed Prepare → simulated Publish → example 24h result →
  Learn. `javascript:` tracked URL input disabled confirmation. After the repair,
  the 24h read no longer produces a final angle candidate before the 72h window.
- Fictional C.1 passed explicit opportunity load → kit review → both acknowledgements
  → one ready queue/draft → publish-dialog cancel (queue retained) → simulated second
  publish (only its queue consumed, separate Timeline execution). No source/model
  request or cloud save was made. Screenshots are local artifacts under
  `artifacts/release-2026-10-24/`, not release source.

Production is still at `01886f90bb6cd593059b8a73726c21124b82b907` according to the
fresh GitHub commit-linked Vercel status; that historical deployment succeeded and
its GitHub CI run `40065918489` passed. This is not acceptance of the new candidate.
The Vercel CLI has no available credentials and its prompted login was cancelled;
the dashboard opens at sign-in. Production Node ≥22 therefore remains an explicit
pre-push gate (the new SDK requires it). The user has been asked to confirm the
project runtime or sign in; no credential, project setting or security policy was
changed as a shortcut. The existing Git integration can deploy the authorized push
once that gate is resolved.

The app candidate is committed locally as `c2fc40c` and is **not pushed/deployed**.
Built-candidate smoke passed all six probes at `2026-10-25T00:54:24.481Z`; a fresh
pre-push production smoke also passed at `2026-10-25T00:54:44.206Z` (both October 24
locally). The production pass exercises the old deployed revision, not this candidate.
The user reported signing in, but the controlled Vercel tab still showed the login
page after refresh. A separate browser was being actively used for another task;
control was stopped without changing it. Direct runtime-version confirmation or a
settings screenshot is sufficient; no password/token, account creation or new CLI
login is required. The existing production-release authorization remains valid.

Authenticated cloud save/refresh/export/two-account isolation, fresh paid-provider
acceptance after this SDK migration, real activation/retention, relational ownership
constraints and cross-device conflict control remain pending. C.2 is not delivered.

### Runtime gate resolution and final revalidation

On October 24 (America/Los_Angeles), the official CLI was installed and the user
completed its login. `vercel project inspect --non-interactive` from this checkout
confirmed `zhengbrodys-projects/postbeacon`, project
`prj_OHhaaAA1bjMJWiAKgdIM1W0Oc5lm`, and existing **Node 24.x**. This supersedes the
earlier unavailable-credential/runtime blocker above; no runtime, environment,
SQL or model setting was modified. The separately installed MCP plugin still lacks
the team grant; its 403 is not treated as proof that the CLI cannot access the project.

A fresh full run on Node 24.22.1 initially exposed a test-fixture defect: the webhook
helper replaced the first Base64 signature character with `x`, leaving an already
`x`-prefixed signature unchanged. Freezing `Date.now()` at 1792880021000 reproduced
the failure before repair. The helper now flips a signature bit; the fixed-clock
401/no-plan-change regression passes. No production webhook code was changed.

Final Node 24.22.1 gates pass: typecheck, lint, format, **569 offline tests** (three
live skipped), production build, and dependency audit (zero known advisories).
The built candidate passed all six public probes at `2026-10-25T01:09:06.870Z`;
old-production pre-push smoke passed at `2026-10-25T01:09:03.710Z` (October 24 local).
The prior desktop/mobile acceptance remains applicable because this final repair
changes only the test fixture. Neither smoke is authenticated production acceptance.

### Authorized production release completed

The authorized push advanced main from `01886f9` to
`22e92a10a4d979aec44b3a72fcd470b6b3e2928b`, including app/security commit `c2fc40c`,
acceptance record `5e6454c` and the deterministic-test follow-up `22e92a1`.
[GitHub CI 40149521584](https://github.com/zhengbrody/PostBeacon/actions/runs/40149521584)
passed every gate. The commit-linked Vercel status is successful and identifies
[production deployment H2WQsNMgFcRNJ84PnS2FBVLnnSzH](https://vercel.com/zhengbrodys-projects/postbeacon/H2WQsNMgFcRNJ84PnS2FBVLnnSzH).
CLI inspection independently reports Ready, target production, build duration 49s,
and aliases including postbeacon.app and www.postbeacon.app. Direct inspection of
postbeacon.app resolves to the same deployment. No separate local-source deployment
was needed; the existing Git integration deployed the exact pushed revision.

Public post-release smoke on https://postbeacon.app at
`2026-10-25T01:11:04.493Z` passed all six gates (October 24 locally): page 200,
current trial notice, research 401, foreign-origin research 403, export 401 and
public metrics 401. The checker still correctly reports `productionAccepted: false`.
A deployment-scoped error/fatal scan covering
`2026-10-25T01:06:13.931Z`–`2026-10-25T01:11:13.931Z` returned zero records, with no
excluded intervals or further page. This short, low-traffic observation does not
establish a complete monitoring setup or prove the absence of runtime errors.

CI passed with action-runtime and ubuntu-latest migration notices. These are
maintenance follow-ups, not failed gates. This release changed no SQL, production
environment variable, runtime setting or provider/model selection and made no paid
request, real project/account write/delete or social post. Real authenticated
cloud/account/relational/concurrency checks, migrated-SDK live-provider acceptance,
activation/retention and C.2 remain separate, uncompleted work. This record supersedes
the earlier local-only/runtime-blocked snapshots without deleting their evidence.
