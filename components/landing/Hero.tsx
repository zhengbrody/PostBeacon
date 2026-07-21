import { ButtonLink } from "@/components/ui/Button";

export function Hero() {
  return (
    <section className="bg-grid">
      <div className="mx-auto max-w-3xl px-5 pb-16 pt-20 text-center sm:pt-28">
        <span className="inline-block rounded-full border border-line bg-surface px-3 py-1 text-xs text-neutral-400">
          Your evidence-first growth workspace
        </span>
        <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Know what to do next.
          <br />
          <span className="text-gradient">Learn from what happens.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base text-neutral-300 sm:text-lg">
          Paste your product URL. PostBeacon verifies the facts, chooses one useful growth
          experiment, prepares the draft, and turns the result into your next move.
        </p>
        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <ButtonLink href="/app">Find my next move →</ButtonLink>
          <ButtonLink href="/app?demo=1" variant="outline">
            Try the 3-minute demo
          </ButtonLink>
        </div>
        <p className="mt-4 text-xs text-neutral-500">
          No auto-posting. Every draft passes a truth check; you review and publish by hand.
        </p>
      </div>
    </section>
  );
}
