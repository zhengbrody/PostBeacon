# M25.0 — Evidence Receipt

## Product problem

The signed-in Analyze flow previously returned a Fact Ledger but gave the
operator no bounded proof of what the server fetched, which provider completed
the analysis, what was verified, or what the submitted extract did not cover.
Adding more polished Diagnose copy on top of that invisible boundary would
make the product feel more certain without making it more trustworthy.

## Contract

- The primary landing page is required. Its failure closes the analysis.
- The operator may explicitly add up to four Pricing, Docs, Changelog or
  GitHub URLs. PostBeacon never crawls adjacent pages automatically.
- Every URL passes the existing `normalizeScrapeUrl → assertPublicHttpUrl →
  safeFetch` boundary. Optional-source failures are isolated and visible.
- Fetches run with concurrency two. Each optional extract contributes at most
  3,000 characters to the analysis; the primary extract keeps its 6,000
  character cap.
- Observed facts are matched by code against each submitted corpus. The first
  source that contains the exact quote/claim becomes `Fact.sourceUrl`; the
  model cannot nominate its own source URL.
- The server constructs the receipt only after work completes. No client
  timer or optimistic checklist can mark a step complete.
- The receipt contains URLs, bounded titles, fetch mode, truncation flags,
  counts, coverage labels and actual provider provenance. It never contains
  page text, prompts, identity fields or raw upstream errors.

## Honest coverage language

`foundAreas` and `notFoundAreas` are deterministic pattern reads over the
submitted extracts. The UI always says **not found in submitted extracts**.
It never turns that into “the product/site does not contain this.” A
truncation flag remains visible per source.

## State and compatibility

- `FlowState.analysisReceipt` is the single client state seam.
- `ANALYZED` replaces the previous receipt and invalidates the previous
  strategy/result through the existing reducer transition.
- Draft schema v8 stores the bounded receipt in localStorage or
  `projects.meta.analysisReceipt`; no Supabase schema migration is required.
- Local and Supabase JSON pass through `normalizeAnalysisReceipt()` before UI
  use. Invalid provider/source shapes degrade to no receipt instead of
  crashing or producing executable links.
- Old v1–v7 projects load with `analysisReceipt = null` and retain all prior
  plan/workspace data.
- JSON account export already includes `projects.meta`; Markdown/JSON plan
  export explicitly includes the compact receipt.

## UI

Diagnose begins with a compact server-verified receipt:

- URLs validated
- pages fetched
- facts extracted
- claims verified
- actual provider and fallback

The disclosure shows per-source success/failure, static/rendered mode,
truncation, found/not-found areas and four optional evidence inputs. Re-running
states clearly that it replaces the current analysis and clears the stale
strategy.

## Acceptance

- A one-page analysis shows a real receipt after completion, never fake
  progress during loading.
- Up to four allowlisted evidence-source kinds are accepted and duplicate URLs
  are removed.
- Private/invalid optional URLs are blocked before fetch and shown as failed.
- A failed optional page does not hide the successful primary analysis.
- A quote found only on Pricing receives the Pricing URL, not the landing URL.
- Actual provider/fallback metadata survives save, reload and export.
- Receipt JSON contains no submitted page body or raw upstream error.
- Typecheck, offline tests, lint, format, production build and browser
  acceptance remain green.

## Deliberately next

The compact Diagnose summary and `SuccessContract` are the next slice. They
must consume this trusted evidence boundary. Success Contract also requires a
single shared learning-loop completion rule across UI, Vercel analytics and
operator metrics; it is intentionally not mixed into this milestone.
