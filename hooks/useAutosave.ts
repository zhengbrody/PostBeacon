"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSupabaseUser } from "@/components/app/SignIn";
import { saveDraft, clearDraft, DRAFT_SCHEMA_VERSION } from "@/lib/storage";
import { syncWorkspaceTables } from "@/lib/workspace";
import type {
  Fact,
  GenerateResult,
  MarketingStrategy,
  ProductMemory,
  ProductProfile,
  WorkspaceState,
} from "@/lib/types";

interface AutosaveFlow {
  snapshot: {
    url: string;
    profile: ProductProfile | null;
    strategy: MarketingStrategy | null;
    result: GenerateResult | null;
    posted: Record<string, boolean>;
    selected: string[];
    facts: Fact[];
    workspace: WorkspaceState;
    memory: ProductMemory;
  };
  launchDate: string;
  projectId: string;
  setProjectId: (id: string) => void;
  demo?: boolean; // when viewing the example plan, never persist it
}

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Debounced autosave for the launch flow. Anonymous → a single localStorage
 * draft; signed-in → upsert one row in Supabase `projects` (stable id). The app
 * treats sign-in/account changes as a hard client-data boundary, so it never
 * assumes an existing browser draft belongs to the arriving account.
 */
export function useAutosave(f: AutosaveFlow) {
  const { userId, supabase } = useSupabaseUser();
  const [lastSaved, setLastSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest values in a ref so the debounced persist() never reads stale state.
  const ref = useRef({ ...f, userId, supabase });
  ref.current = { ...f, userId, supabase };

  const persist = useCallback(async () => {
    const {
      snapshot: snap,
      launchDate,
      projectId,
      setProjectId,
      userId,
      supabase,
      demo,
    } = ref.current;
    if (demo) return; // the example plan is read-only — don't save it
    if (!(snap.profile || snap.url)) return;

    let id = projectId;
    if (!id) {
      id = crypto.randomUUID();
      setProjectId(id);
    }

    setSaving(true);
    try {
      if (userId && supabase) {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user || u.user.id !== userId) return;
        const { error } = await supabase.from("projects").upsert(
          {
            id,
            user_id: u.user.id,
            name: snap.profile?.name || snap.url || "Untitled",
            url: snap.url,
            profile: snap.profile,
            strategy: snap.strategy,
            result: snap.result,
            posted: snap.posted,
            // Client-side plan state that isn't a server response: channel
            // selection, launch date, the M13 fact ledger — plus the
            // serialization version so future readers can migrate.
            meta: {
              schemaVersion: DRAFT_SCHEMA_VERSION,
              selected: snap.selected,
              launchDate,
              facts: snap.facts,
              workspace: snap.workspace,
              memory: snap.memory,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );
        if (!error) {
          clearDraft(); // migrated to the account
          setLastSaved(timeNow());
          // Write-through to the normalized workspace tables (best-effort,
          // feature-detected; meta.workspace above remains the hydration
          // source — see docs/M15-workspace.md §11).
          void syncWorkspaceTables(supabase, u.user.id, id, {
            workspace: snap.workspace,
            profile: snap.profile,
            launchDate,
          });
        }
      } else {
        saveDraft({
          id,
          url: snap.url,
          profile: snap.profile,
          strategy: snap.strategy,
          result: snap.result,
          posted: snap.posted,
          selected: snap.selected,
          launchDate,
          facts: snap.facts,
          workspace: snap.workspace,
          memory: snap.memory,
        });
        setLastSaved(timeNow());
      }
    } finally {
      setSaving(false);
    }
  }, []);

  // Re-run whenever the content, the launch date, or the auth state changes.
  // `f.snapshot` is memoized upstream, so its identity is a cheap change signal.
  const hasContent = !!(f.snapshot.profile || f.snapshot.url);

  useEffect(() => {
    if (!hasContent) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(persist, 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.snapshot, f.launchDate, userId]);

  return { lastSaved, saving, saveNow: persist };
}
