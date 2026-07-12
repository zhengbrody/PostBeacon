import { ButtonLink } from "@/components/ui/Button";

export function Hero() {
  return (
    <section className="bg-grid">
      <div className="mx-auto max-w-3xl px-5 pb-16 pt-20 text-center sm:pt-28">
        <span className="inline-block rounded-full border border-line bg-surface px-3 py-1 text-xs text-neutral-400">
          Your AI Chief Marketing Officer
        </span>
        <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Paste a URL.
          <br />
          <span className="text-gradient">Launch everywhere.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base text-neutral-300 sm:text-lg">
          Paste your product URL and get a full 0→1 launch plan: positioning, ranked
          channels, ready-to-post content written to not sound like AI, and a calendar. The
          CMO work, for vibecoders who&apos;d rather ship.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <ButtonLink href="/app">Start free →</ButtonLink>
          <ButtonLink href="/app?demo=1" variant="outline">
            See an example plan
          </ButtonLink>
        </div>
        <p className="mt-4 text-xs text-neutral-500">
          No auto-posting. You stay in control — copy, tweak, ship.
        </p>
      </div>
    </section>
  );
}
