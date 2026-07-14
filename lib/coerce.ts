/**
 * Coercers for loose JSON (model output, persisted blobs). These existed as
 * per-file `str`/`arr` copies typed `any` in four modules before M14 — one
 * shared, `unknown`-typed set kills both the duplication and the `any`s.
 */

/** The string, or "" — no trimming (faithful to what the model sent). */
export const asString = (v: unknown): string => (typeof v === "string" ? v : "");

/** Trimmed string clipped to a byte budget — for prompt/context assembly. */
export const clipString = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** String array with falsy entries dropped; optionally capped. */
export const asStringList = (v: unknown, max?: number): string[] => {
  const list = Array.isArray(v) ? v.map(asString).filter(Boolean) : [];
  return max === undefined ? list : list.slice(0, max);
};

/** The object as an indexable record, or {} for anything non-object. */
export const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** Array of records (non-arrays → [], non-object items → {}). */
export const asRecordList = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.map(asRecord) : [];

/**
 * A pasted metric ("12,000", " 45 ", "1 234") as a non-negative finite number,
 * or undefined for empty/unparseable input — "not measured" must stay absent,
 * and NaN/Infinity must never enter state: they mis-verdict locally, serialize
 * to null, and a null metric fails the copilot request schema forever after.
 */
export const parseMetric = (v: string): number | undefined => {
  const cleaned = v.trim().replace(/[,\s]/g, "");
  if (cleaned === "") return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.max(0, n) : undefined;
};
