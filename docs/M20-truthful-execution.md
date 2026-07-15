# M20 — Truthful execution contract

## Problem

A real MindMarket run proved that a fluent draft can still be commercially unsafe. The
generator invented a founder identity, personal anecdotes, testimonials, traction,
limitations and a demo-link placeholder. The workflow also let Today recommend one channel
while Copilot silently targeted another, and repeated saved project names were impossible to
distinguish.

M20 treats these as product-state problems, not prompt-tuning problems.

## Contract

### 1. Publishing voice is explicit

- Every project chooses `brand` or `founder` voice during setup.
- `brand` is the safe default for old and new projects.
- Founder voice permits first-person language; it never permits invented biography,
  credentials, experiences, customers or results.
- The analyze and generate prompt versions are bumped whenever this contract changes.

### 2. Truth is a hard last-mile gate

`lib/contentSafety.ts` is a deterministic, local audit for high-confidence failures:

- unresolved placeholders;
- brand copy impersonating a person;
- invented anecdotes, identities and testimonials;
- unsupported limitations and traction metrics;
- outcome promises for regulated or high-risk products.

Every generated draft shows its result beside the draft. A failed draft remains editable and
regeneratable, but Copy, bulk Copy and experiment tracking are disabled until it passes. The
same audit runs again inside the publish confirmation so no alternate entry point bypasses it.

This is deliberately not a vague AI score. It blocks a small set of explainable failures and
shows the exact excerpt plus the fix.

### 3. Channel mechanics are real

Only platforms with a native authored comment/reply mechanic may receive conversation
starters. Pitch emails, standalone articles, READMEs and directory listings get an empty
array in code even if the model ignores the instruction. Historical impossible reply cards
are hidden.

### 4. One action has one channel context

Today passes its `platformId` when opening Copilot. The panel selects that target before the
founder rewrites or asks for conversation starters. Active experiment questions do the same.
Thread-only controls disappear for channels without that mechanic.

### 5. No response is valid data

At a real checkpoint, “No measurable response” records explicit zeros for the five supported
metrics and immediately runs the same deterministic verdict engine. At 24h it preserves the
72h wait; at 72h it recommends stopping or reallocating. Empty fields still mean “not
measured” and are never silently converted to zero.

### 6. Saved projects are recognizable

Saved-project chips show product name, source hostname and last-updated date. Accessible
labels include the complete identity, while database ids stay internal.

## Acceptance criteria

- A draft containing `[insert demo link here]` cannot be copied or tracked.
- Brand voice cannot publish `I`, `me` or `my`; switching to founder voice alone does not
  permit invented professional identity or anecdote.
- A verified limitation or traction number passes; an unsupported one does not.
- The publish dialog independently enforces the same audit.
- Today → Copilot keeps the recommended platform selected.
- Non-thread channels never display or generate fake first replies.
- A checked zero-response result is one click and produces the checkpoint-aware read.
- Duplicate product names remain distinguishable in the project bar.
- Typecheck, lint, formatting, offline tests and production build stay green.
