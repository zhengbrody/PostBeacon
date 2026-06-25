import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { SignIn } from "@/components/app/SignIn";

export function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-line/60 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Post<span className="text-accent-400">Beacon</span>
        </Link>
        <div className="flex items-center gap-1 text-sm">
          <a href="#how" className="hidden rounded-lg px-3 py-2 text-neutral-300 hover:text-white sm:block">
            How it works
          </a>
          <a href="#platforms" className="hidden rounded-lg px-3 py-2 text-neutral-300 hover:text-white sm:block">
            Platforms
          </a>
          <a href="#faq" className="hidden rounded-lg px-3 py-2 text-neutral-300 hover:text-white sm:block">
            FAQ
          </a>
          <div className="ml-1 hidden md:block">
            <SignIn />
          </div>
          <ButtonLink href="/app" size="sm" className="ml-2">
            Launch app →
          </ButtonLink>
        </div>
      </div>
    </nav>
  );
}
