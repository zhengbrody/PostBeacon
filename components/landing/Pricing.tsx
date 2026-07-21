import { ButtonLink } from "@/components/ui/Button";

// Keep PRO_PRICE in sync with your Polar product price.
const PRO_PRICE = "$9";
const PRO_PERIOD = "/mo";

const TIERS = [
  {
    name: "Free",
    price: "$0",
    period: "",
    tagline: "Close your first learning loops",
    cta: "Start free",
    highlight: false,
    features: [
      "3 full launch workspaces",
      "All 19+ platforms evaluated",
      "One evidence-backed next move",
      "Truth-checked, ready-to-post draft",
      "24h/72h result and verdict",
    ],
  },
  {
    name: "Pro",
    price: PRO_PRICE,
    period: PRO_PERIOD,
    tagline: "Keep learning as you ship",
    cta: "Go Pro",
    highlight: true,
    features: [
      "Everything in Free",
      "Unlimited launch workspaces",
      "Regenerate & A/B hooks",
      "Grounded niche-channel discovery",
      "Project memory and weekly review",
    ],
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-4xl px-5 py-20">
      <h2 className="text-center text-3xl font-bold tracking-tight">Simple pricing</h2>
      <p className="mt-3 text-center text-sm text-neutral-400">
        Start free. Upgrade when your learning loop becomes a habit.
      </p>
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {TIERS.map((t) => (
          <div
            key={t.name}
            className={`rounded-2xl border p-6 ${
              t.highlight
                ? "border-accent-500/60 bg-accent-600/10"
                : "border-line bg-surface"
            }`}
          >
            <h3 className="text-lg font-semibold">{t.name}</h3>
            <p className="mt-1 text-sm text-neutral-400">{t.tagline}</p>
            <p className="mt-4">
              <span className="text-3xl font-bold">{t.price}</span>
              <span className="text-sm text-neutral-500">{t.period}</span>
            </p>
            <ul className="mt-5 space-y-2 text-sm text-neutral-300">
              {t.features.map((feat) => (
                <li key={feat} className="flex gap-2">
                  <span className="text-accent-400">✓</span>
                  {feat}
                </li>
              ))}
            </ul>
            <ButtonLink
              href="/app"
              variant={t.highlight ? "primary" : "outline"}
              className="mt-6 w-full"
            >
              {t.cta} →
            </ButtonLink>
          </div>
        ))}
      </div>
    </section>
  );
}
