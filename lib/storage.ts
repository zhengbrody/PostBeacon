// Local "current draft" persistence for anonymous users. Signed-in users persist
// to Supabase instead (see hooks/useAutosave). One draft slot, last-write-wins.

const KEY = "postbeacon:draft";

export interface Draft {
  id?: string;
  url?: string;
  profile?: any;
  strategy?: any;
  result?: any;
  posted?: Record<string, boolean>;
  selected?: string[]; // channels checked for generation
  launchDate?: string;
  facts?: any[]; // M13 fact ledger (provenance for the profile)
}

export function loadDraft(): Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft: Draft) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(draft));
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
