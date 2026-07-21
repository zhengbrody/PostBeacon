const STEPS = [
  {
    n: "1",
    title: "Verify the facts",
    body: "Paste your URL. PostBeacon separates what the page actually says from what is inferred or still unknown.",
  },
  {
    n: "2",
    title: "Choose one experiment",
    body: "See the next best channel, audience, angle, and signal to watch — with the reason it beats the alternatives.",
  },
  {
    n: "3",
    title: "Publish with control",
    body: "Edit a platform-native draft, pass the truth check, and publish it yourself. PostBeacon never posts for you.",
  },
  {
    n: "4",
    title: "Measure and adapt",
    body: "Record the 24h and 72h signals. PostBeacon explains the result and turns it into the next experiment.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-5xl px-5 py-20">
      <h2 className="text-center text-3xl font-bold tracking-tight">
        From product facts to the next learning
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-sm text-neutral-400">
        Not another report to file away. One focused loop you can finish, learn from, and
        repeat.
      </p>
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
