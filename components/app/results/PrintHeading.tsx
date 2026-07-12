/** Tab heading that only exists on paper — screens have the tab bar instead. */
export function PrintHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-4 text-xl font-bold">{children}</h2>;
}
