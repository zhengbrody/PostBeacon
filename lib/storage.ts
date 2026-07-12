// Local "current draft" persistence for anonymous users. Signed-in users persist
// to Supabase instead (see hooks/useAutosave). One draft slot, last-write-wins.

import type {
  Fact,
  GenerateResult,
  MarketingStrategy,
  ProductProfile,
  WorkspaceState,
} from "./types";

const KEY = "postbeacon:draft";

/**
 * Serialization version for persisted plans (the localStorage draft AND the
 * Supabase `projects.meta` jsonb both carry it).
 *   v1 — pre-M11: url/profile/strategy/result/posted only
 *   v2 — M11: + selected, launchDate
 *   v3 — M13: + facts
 *   v4 — M15: + workspace (experiments, task log, weekly budget)
 * Bump this and extend migrateDraft() when the persisted shape changes.
 */
export const DRAFT_SCHEMA_VERSION = 4;

export interface Draft {
  schemaVersion?: number; // absent on pre-versioning saves; stamped on write
  id?: string;
  url?: string;
  profile?: ProductProfile | null;
  strategy?: MarketingStrategy | null;
  result?: GenerateResult | null;
  posted?: Record<string, boolean>;
  selected?: string[]; // channels checked for generation
  launchDate?: string;
  facts?: Fact[]; // M13 fact ledger (provenance for the profile)
  workspace?: WorkspaceState; // M15 launch workspace (experiments, task log)
}

/**
 * Bring any historical draft blob up to the current shape. Migrations only
 * add structural defaults; derivations that need live data (e.g. a default
 * channel selection from strategy scores) stay in the flow reducer's
 * PROJECT_LOADED, which handles drafts and Supabase rows alike.
 */
export function migrateDraft(raw: unknown): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Draft;
  const version =
    typeof d.schemaVersion === "number"
      ? d.schemaVersion
      : d.selected !== undefined || d.launchDate !== undefined
        ? 2
        : 1;
  const out: Draft = { ...d, schemaVersion: version };
  if (version < 3) out.facts = out.facts ?? [];
  if (version < 4) out.workspace = out.workspace ?? { experiments: [], taskLog: [] };
  out.schemaVersion = DRAFT_SCHEMA_VERSION;
  return out;
}

export function loadDraft(): Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrateDraft(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft: Omit<Draft, "schemaVersion">) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...draft, schemaVersion: DRAFT_SCHEMA_VERSION })
    );
  } catch {
    // quota / private mode — best-effort
  }
}

export function clearDraft() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
