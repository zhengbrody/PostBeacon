import { ButtonLink } from "@/components/ui/Button";

export function Footer() {
  return (
    <footer className="border-t border-line/60">
      <div className="mx-auto max-w-5xl px-5 py-16 text-center">
        <h2 className="text-2xl font-bold tracking-tight">
          Stop guessing where to launch.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-neutral-400">
          Get your full multi-platform plan in under a minute.
        </p>
        <ButtonLink href="/app" className="mt-6">
          Launch app →
        </ButtonLink>
        <p className="mt-10 text-xs text-neutral-600">
          © {new Date().getFullYear()} PostBeacon · postbeacon.app
        </p>
      </div>
    </footer>
  );
}
