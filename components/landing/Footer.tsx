import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";

export function Footer() {
  return (
    <footer className="border-t border-line/60">
      <div className="mx-auto max-w-5xl px-5 py-16 text-center">
        <h2 className="text-2xl font-bold tracking-tight">
          Turn the next post into a learning.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-neutral-400">
          Start with verified product facts, publish one focused experiment, and let the
          result shape what you do next.
        </p>
        <ButtonLink href="/app" className="mt-6">
          Find my next move →
        </ButtonLink>
        <div className="mt-10 flex justify-center gap-4 text-xs text-neutral-500">
          <Link href="/privacy" className="hover:text-neutral-300">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-neutral-300">
            Terms
          </Link>
          <Link href="/subprocessors" className="hover:text-neutral-300">
            Data vendors
          </Link>
        </div>
        <p className="mt-4 text-xs text-neutral-600">
          © {new Date().getFullYear()} PostBeacon · postbeacon.app · No auto-posting.
          PostBeacon does not train on your content; your selected AI provider’s policy
          applies.
        </p>
      </div>
    </footer>
  );
}
