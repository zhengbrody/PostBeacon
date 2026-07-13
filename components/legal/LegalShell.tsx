import Link from "next/link";
import { PRIVACY_LAST_UPDATED } from "@/lib/privacy";
import { FEEDBACK_URL } from "@/lib/site";

/**
 * Shared shell for the /privacy, /terms and /subprocessors pages: minimal
 * header, an honest "draft pending legal review" banner, and the legal footer.
 * Copy renders from lib/privacy.ts wherever possible so pages can’t drift
 * from what the code does.
 */
export function LegalShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <nav className="border-b border-line/60">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
          <Link href="/" className="text-lg font-bold tracking-tight">
            Post<span className="text-accent-400">Beacon</span>
          </Link>
          <div className="flex gap-4 text-xs text-neutral-400">
            <Link href="/privacy" className="hover:text-white">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-white">
              Terms
            </Link>
            <Link href="/subprocessors" className="hover:text-white">
              Subprocessors
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-xs text-neutral-500">
          Last updated {PRIVACY_LAST_UPDATED} ·{" "}
          <span className="text-amber-400/90">
            Beta draft — under legal review; wording may change.
          </span>
        </p>
        <p className="mt-5 text-sm leading-relaxed text-neutral-300">{intro}</p>
        <div className="mt-8 space-y-8">{children}</div>

        <p className="mt-12 border-t border-line/60 pt-6 text-xs text-neutral-500">
          Questions or requests about your data:{" "}
          <a
            href={FEEDBACK_URL}
            className="text-accent-300 hover:underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            contact us
          </a>
          . © {new Date().getFullYear()} PostBeacon · postbeacon.app
        </p>
      </main>
    </>
  );
}

/** A titled section with consistent typography. */
export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-neutral-100">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-neutral-300">
        {children}
      </div>
    </section>
  );
}

/** Consistent dark-theme table for the inventory/subprocessor grids. */
export function LegalTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[40rem] text-left text-xs">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-neutral-400">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {rows.map((cells, i) => (
            <tr key={i} className="align-top">
              {cells.map((c, j) => (
                <td key={j} className="px-3 py-2 text-neutral-300">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
