export interface TabDef {
  id: string;
  label: string;
  count?: number;
}

/**
 * Horizontal tab bar (controlled — panels are owned by the caller). Rendered
 * as a <nav>, so the global print rules hide it on paper automatically.
 */
export function Tabs({
  tabs,
  active,
  onSelect,
  className = "",
}: {
  tabs: TabDef[];
  active: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const move = (dir: 1 | -1) => {
    const i = tabs.findIndex((t) => t.id === active);
    onSelect(tabs[(i + dir + tabs.length) % tabs.length].id);
  };
  return (
    <nav
      role="tablist"
      className={`no-print flex gap-1 overflow-x-auto border-b border-line ${className}`}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") move(1);
        if (e.key === "ArrowLeft") move(-1);
      }}
    >
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(t.id)}
            className={`-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
              on
                ? "border-accent-500 text-accent-300"
                : "border-transparent text-neutral-400 hover:text-neutral-100"
            }`}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-neutral-400">
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
