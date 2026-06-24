const FAQS = [
  {
    q: "Does PostBeacon post for me automatically?",
    a: "No — and that's deliberate. Auto-posting gets accounts flagged and banned. PostBeacon writes native, ready-to-post content and a calendar; you copy and post, staying fully in control.",
  },
  {
    q: "How does it know which platforms are right for my product?",
    a: "It builds a profile from your URL, then scores every platform in its universe for fit to your specific product and audience — so a fintech tool and a dev library get very different plans.",
  },
  {
    q: "Which AI model does it use?",
    a: "Claude or OpenAI — switchable. Bring your own API key.",
  },
  {
    q: "Is my data saved?",
    a: "Only if you sign in. Projects are stored to your account (Supabase) with row-level security so only you can see them. Without signing in, nothing is persisted.",
  },
  {
    q: "Who is it for?",
    a: "Vibecoders and indie makers shipping to the English developer/startup community who want a real go-to-market without hiring a marketer.",
  },
];

export function FAQ() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-5 py-20">
      <h2 className="text-center text-3xl font-bold tracking-tight">FAQ</h2>
      <div className="mt-10 divide-y divide-line">
        {FAQS.map((f) => (
          <details key={f.q} className="group py-4">
            <summary className="cursor-pointer list-none font-medium text-neutral-100 marker:content-none">
              <span className="flex items-center justify-between gap-4">
                {f.q}
                <span className="text-neutral-500 transition-transform group-open:rotate-45">
                  +
                </span>
              </span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-neutral-400">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
