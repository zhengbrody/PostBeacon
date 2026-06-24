const STEPS = [
  {
    n: "1",
    title: "Drop your URL",
    body: "PostBeacon reads your landing page and distills a sharp product profile — value, audience, differentiators.",
  },
  {
    n: "2",
    title: "Review the profile",
    body: "Tweak anything that's off. You're the founder; the AI is your CMO, not your replacement.",
  },
  {
    n: "3",
    title: "Get your strategy",
    body: "Every platform scored & ranked for your product, with positioning and the exact angle to use on each.",
  },
  {
    n: "4",
    title: "Ship the content",
    body: "Native, ready-to-post copy per platform + a launch calendar. Copy, post, mark done.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-5xl px-5 py-20">
      <h2 className="text-center text-3xl font-bold tracking-tight">
        From URL to launch in four steps
      </h2>
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-xl border border-line bg-surface/60 p-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-600/20 font-mono text-accent-300">
              {s.n}
            </div>
            <h3 className="mt-4 font-semibold">{s.title}</h3>
            <p className="mt-1.5 text-sm text-neutral-400">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
