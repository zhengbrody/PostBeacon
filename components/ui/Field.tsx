const inputClass =
  "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none transition-colors focus:border-accent-500";

export function Field({
  label,
  value,
  onChange,
  textarea,
  placeholder,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const id = `f-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-neutral-400">
        {label}
      </label>
      {textarea ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          placeholder={placeholder}
          className={inputClass}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={inputClass}
        />
      )}
    </div>
  );
}
