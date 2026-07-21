import {
  accountsConfigured,
  guestPreviewConfigured,
  providerFallbackNotice,
} from "@/lib/privacy";

const dataLocationAnswer = guestPreviewConfigured()
  ? "Before sign-in, the one-channel preview is processed by the server and AI provider but is not written to the project database. Its result stays in this browser for up to one hour for an explicit sign-in handoff. Signed-in projects use owner-only Supabase rows. You can export or delete your account data in the app."
  : accountsConfigured()
    ? "The fictional walkthrough is never saved. Your own plans are saved only after sign-in, in owner-only Supabase rows. You can export or delete your account data in the app."
    : "In local-only mode, the current draft stays in your browser's localStorage. Clear it from the start step or clear browser data.";

const FAQS = [
  {
    q: "Does PostBeacon post for me automatically?",
    a: "No — and that's deliberate. PostBeacon prepares and truth-checks the draft, but you review every change and publish it yourself. Confirming the publish starts the 24h/72h result loop.",
  },
  {
    q: "How does it know which platforms are right for my product?",
    a: "It builds a fact ledger from your URL, then scores every platform for audience, intent, native-content fit, founder access, and risk. You get one next best experiment first; the full ranking remains in the Strategy library.",
  },
  {
    q: "Is this another marketing report I use once?",
    a: "No. The initial analysis opens into a workspace: prepare one experiment, publish manually, record the 24h and 72h signals, receive an explainable verdict, then act on the next experiment. The product becomes more useful as your project accumulates real evidence.",
  },
  {
    q: "Which AI model does it use?",
    a: `OpenAI or DeepSeek in the current beta — you choose the primary from whatever the deployment has configured. ${providerFallbackNotice()} The picker and Privacy page explain what data is sent.`,
  },
  {
    q: "Where does my data live?",
    a: dataLocationAnswer,
  },
  {
    q: "Who is it for?",
    a: "Vibecoders and indie makers with a live product who need their first users, but don't want a generic content machine or another plan they still have to translate into action.",
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
