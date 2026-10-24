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
