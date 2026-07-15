export interface ProjectIdentity {
  name: string;
  detail: string;
  label: string;
}

function hostnameOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return "saved project";
  }
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "date unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

/** Makes same-name saved projects distinguishable without exposing internal ids. */
export function projectIdentity(
  name: string,
  url: string,
  updatedAt: string
): ProjectIdentity {
  const cleanName = name.trim() || "Untitled project";
  const detail = `${hostnameOf(url)} · ${shortDate(updatedAt)}`;
  return { name: cleanName, detail, label: `${cleanName} — ${detail}` };
}
