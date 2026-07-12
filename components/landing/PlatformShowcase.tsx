import { PLATFORMS, type PlatformCategory } from "@/lib/platforms";

const CATEGORY_LABELS: Record<PlatformCategory, string> = {
  launch: "Launch",
  "dev-community": "Dev communities",
  social: "Social",
  content: "Content",
  video: "Video",
  "forum-niche": "Niche forums",
  newsletter: "Newsletters",
  aggregator: "Aggregators",
};

export function PlatformShowcase() {
  const grouped = PLATFORMS.reduce<Record<string, string[]>>((acc, p) => {
    (acc[p.category] ||= []).push(p.name);
    return acc;
  }, {});

  return (
    <section id="platforms" className="border-y border-line/60 bg-surface/30">
      <div className="mx-auto max-w-5xl px-5 py-20">
        <h2 className="text-center text-3xl font-bold tracking-tight">
          One scan. Every channel that matters.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-neutral-400">
          PostBeacon evaluates {PLATFORMS.length}+ platforms across{" "}
          {Object.keys(grouped).length} categories and tells you which deserve your limited
          time.
        </p>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(grouped).map(([cat, names]) => (
            <div key={cat} className="rounded-xl border border-line bg-surface/60 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-accent-300">
                {CATEGORY_LABELS[cat as PlatformCategory]}
              </h3>
              <ul className="mt-3 space-y-1.5 text-sm text-neutral-300">
                {names.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
