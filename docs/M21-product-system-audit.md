# M21 — Product & system audit (pre-launch level)

> Full audit of PostBeacon as of `568286f` (M20), run 2026-07-15 against the private-beta
> constraints: no billing, no auto-posting, no cross-user collection, OpenAI primary with
> disclosed DeepSeek fallback, 30-day retention, truthful output, visible/confirmable state
> changes. Baseline gates at audit start: typecheck ✓ · **319 offline tests** ✓ · lint ✓ ·
> format ✓ · build ✓. Only evidence-backed findings are listed; each is labeled
> CONFIRMED / DESIGN GAP / HYPOTHESIS / NEEDS-USER-DATA.

## 1. Current user journey

```
Landing (/)                       /app (login gate when Supabase configured; ?demo=1 bypass)
   │                                  │
   ▼                                  ▼
1. Analyze   URL → scrape → profile + fact ledger (observed/user-confirmed/inferred/unknown)
2. Diagnose  ≤3 clarifying questions · REQUIRED primary goal · launch date · weekly budget
             · publisher voice (brand default | founder)
3. Strategy  19 ranked channels, code-computed score breakdowns → select channels
4. Workspace (Today default)
   ├─ LAUNCH MODE  first-value path (Plan ready → First post → First learning)
   │   └─ Next best move = InlinePostWorkbench: variants A/B, hook chips, edit,
   │      truth gate beside the draft, Copy (gated), Open platform, "I published it"
   ├─ Publish confirm dialog: lifecycle bar, truth gate re-run, venue/angle prefilled
   │   → "Start tracking" → receipt ✓ + Active-experiment card + 24h countdown
   │   → GROWTH MODE (automatic, visible badge flip)
   ├─ Measure: due check-ins open inline in the dominant card; early result allowed
   │   (labeled Early, never replaces scheduled checks); "No measurable response"
   │   records explicit zeros in one click → immediate rule-based verdict
   └─ Learn: verdict + ≤3 next actions; Progress projects the same lifecycle;
      Learn & next (weekly review) has actionable buttons; Strategy Library is reference
```

Browser walkthrough evidence (demo, desktop + 375px mobile): mode badge flips Launch→Growth
on first tracked publish; receipt "✓ X / Twitter experiment started"; countdown "24h result
check in 1d"; zero-response click produces a "no signal" verdict immediately; Progress and
Learn & next are projections of the same experiment (no duplicate workflows); no horizontal
overflow at 375px; zero console errors.

## 2. Data & state flow

```
UI (presentational) ──actions──► hooks/launchFlowReducer (normalize() invariants)
                                    │  facts / strategy / result / workspace / memory
        ┌───────────────────────────┤
        ▼                           ▼
localStorage draft v6      Supabase projects.meta (authoritative hydration)
(anonymous)                + campaigns/experiments/outcomes/tasks mirrors (best-effort)
        │                           │  owner-only RLS, auth-user cascades, delete RPC
        ▼                           ▼
lib/export (MD/JSON incl.   /api/account/export (RLS-scoped) · /api/account/delete
workspace+memory)           (typed confirm, fails closed) · /api/retention (30d)
Model I/O: validate.ts (zod) → engines (facts/scoring/generate/copilotActions)
→ llm.ts (OpenAI primary; DeepSeek only via disclosed NEXT_PUBLIC_DEEPSEEK_FALLBACK)
Last mile: lib/contentSafety.auditDraftSafety beside every draft AND inside publish confirm;
Copy / Copy all / experiment entry points disabled until it passes.
```

## 3. Findings

### P1-1 · Truth gate misses the most common fabricated-traction formats — CONFIRMED

- **Evidence**: `lib/contentSafety.ts:36` — `UNSUPPORTED_METRIC = /\b\d[\d,.]*%?\s*(?:users?|…)\b/i`.
  Node repro: `"12,000 users" → true`, but `"10k users" → false`, `"1M downloads" → false`,
  `"$50k in revenue" → false`, `"2k+ signups" → false`, `"40% of teams" → false`.
- **Repro**: edit any draft to add "Already trusted by 10k users" → truth check stays green;
  Copy and publish remain enabled.
- **User impact**: the exact abbreviation style models prefer for invented traction
  (k/M suffixes, $-amounts, "% of …") sails through the M20 gate — the gate's core promise
  ("unsupported traction metrics" blocked, docs/M20 §2) silently fails for these shapes.
- **Root cause**: the regex recognizes only digit-and-separator numbers immediately followed
  by a countable noun; no magnitude suffixes, no currency prefix, no "% of" linkage.
- **Fix**: extend the matcher to `\d[\d,.]*\s*[kKmMbB]?\+?` with optional `$`/`%` and an
  optional "of" before the noun; keep the existing fact-corpus support check so verified
  numbers still pass. Acceptance: all six repro strings flag when unsupported; a
  ledger-confirmed "10k users" passes.

### P1-2 · X single posts have no character contract — the product's own demo post is unpublishable — CONFIRMED

- **Evidence**: no length instruction in `lib/platforms.ts` twitter guidance and no length
  check anywhere (`grep -rn "280|maxLength" lib/generate.ts lib/platforms.ts` → nothing).
  Browser measurement: the demo's X single post (hook + body as copied) is **389 chars** —
  over X's 280 free-tier limit; variant B (thread) segments are fine (max 120).
- **Repro**: open demo → Next best move (X) → Copy draft → paste into X → post rejected.
- **User impact**: blocks the Publish step of the core loop with content that "looks right
  but cannot be executed" — the exact anti-value the product exists to prevent. Real
  generated posts have no reason to fare better than the hand-written demo.
- **Root cause**: platform structure rules live only as prose guidance to the model; there
  is no per-platform limit in the catalog, no code-side audit, and no visible counter.
- **Fix** (three layers, same contract):
  1. `platforms.ts`: add `charLimit: 280` to twitter/threads catalog entries + explicit
     prompt guidance ("single post ≤260 chars incl. link").
  2. `contentSafety.ts`: new `over-limit` issue when a draft exceeds its platform's
     charLimit **and is not a thread** (multi-segment bodies audit per segment) — same
     visible excerpt/fix treatment, same Copy/publish gating (an unpublishable post is
     unexecutable, which is what the gate protects).
  3. `InlinePostWorkbench`: live character count for limited platforms.
  4. `demo.ts`: shorten the demo X single post to ≤280 (the showcase must pass its own bar).
  Acceptance: a 300-char X single post shows the over-limit issue with the count, Copy
  disabled; a 5×200-char thread passes; Reddit/HN long posts unaffected; demo passes.

### P2-1 · "Open platform" reports success when the popup was blocked — CONFIRMED

- **Evidence**: `components/app/results/InlinePostWorkbench.tsx:97-106` — `window.open(...)`
  return value unchecked; feedback line always says "opened in a new tab ✓".
- **User impact**: with a popup blocker (default in several browsers for non-gesture cases),
  the founder sees a false success receipt — violates the M19 "every click produces truthful
  nearby feedback" contract.
- **Root cause**: unchecked `window.open` return.
- **Fix**: check the return; on `null`, show "Popup blocked — copy the draft and open
  {platform} manually." Acceptance: simulated `window.open → null` produces the honest line.

### P2-2 · CLAUDE.md lost sync with AGENTS.md at M20 — CONFIRMED

- **Evidence**: `grep -c "M20" CLAUDE.md AGENTS.md` → `0` vs `3`. CLAUDE.md's map lacks
  `contentSafety.ts`, `projectIdentity.ts`, the M20 changelog entry and the M20 doc line.
- **Impact**: the two "living architecture" docs disagree; agents/contributors reading
  CLAUDE.md miss the truth-gate layer entirely.
- **Fix**: copy the M20 sections into CLAUDE.md (they are meant to be identical); keep them
  in the M21 sync. Acceptance: `diff` of the M-marker sets is empty.

### P3-1 · Nine sub-32px touch targets on mobile Today — CONFIRMED (minor)

- **Evidence**: 375px viewport probe — 9 of 15 visible buttons measure <32px tall (text-xs
  link-style buttons: Dismiss, Skip, variant chips, footer links). Primary actions (Button
  component) are fine; no horizontal overflow.
- **Impact**: harder tapping on secondary actions; not blocking.
- **Fix suggestion** (not taken this milestone): bump tap padding on link-buttons inside
  cards; audit with a 44px overlay. Deferred — cosmetic, needs a design pass, low risk now.

### Design gaps acknowledged, not fixed here

- **DESIGN GAP**: `TESTIMONIAL` doesn't catch "users love it"-style unattributed praise.
  Deliberate M20 scope ("small set of explainable failures") — widening risks false
  positives on ordinary marketing prose. Revisit with real-user examples.
- **DESIGN GAP**: `FIRST_PERSON` can false-positive on hyphenated domains containing "my-".
  No occurrence observed in catalog/demo/goldens; accept until seen in the wild.

### Hypotheses needing real user data

- **NEEDS-USER-DATA**: rate at which live OpenAI generation exceeds 280 chars for X single
  posts (demo evidence suggests common; measure via the live eval after the fix).
- **NEEDS-USER-DATA**: whether founders understand "Early result" vs scheduled checkpoint
  distinction without coaching (copy reads clear; only usage will confirm).

### Verified healthy (no action)

- Learning loop end-to-end (browser): publish receipt → Growth mode → countdown → early
  zero-response → instant "no signal" verdict → Progress/Learn projections update; console clean.
- Truth gate blocking path (browser): injected `[insert demo link here]` → issue + excerpt
  shown, Copy AND "I published it" disabled; publish dialog re-runs the audit independently.
- Copilot context includes real verdicts and WINNING/LOSING angles with experiment evidence
  (`lib/copilot.ts:151-190`) — next-experiment suggestions are grounded, not generic.
- Security posture unchanged and covered by tests: RLS/cascade/RPC schema proofs, SSRF
  policy, zod boundaries, no-console + redaction, DeepSeek fallback disclosure gating
  (`tests/privacy.test.ts`), reminders fail-closed opt-in chain.
- State model: all writes flow through `launchFlowReducer`; no parallel-useState drift found
  in M18–M20 additions; `madge` reports no cycles.

## 4. M21 fix scope (chosen)

**"Executable platform contract + tighter truth gate"** — P1-1, P1-2, P2-1, P2-2 together:
one coherent milestone about the same promise (generated content is truthful AND executable),
small surface (contentSafety, platforms, generate prompt line, workbench counter, demo copy,
docs sync), no schema/SQL, no new dependencies, all behavior behind existing reducer/type
boundaries. P3-1 deferred (design pass).

Acceptance = per-finding criteria above + all five gates green + browser re-verification of
the full Prepare → Publish → Measure → Learn loop on desktop and mobile.
