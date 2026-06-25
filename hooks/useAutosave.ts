"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSupabaseUser } from "@/components/app/SignIn";
import { saveDraft, clearDraft } from "@/lib/storage";

interface AutosaveFlow {
  snapshot: {
    url: string;
    profile: any;
    strategy: any;
    result: any;
    posted: Record<string, boolean>;
  };
  launchDate: string;
  projectId: string;
  setProjectId: (id: string) => void;
}

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Debounced autosave for the launch flow. Anonymous → a single localStorage
 * draft; signed-in → upsert one row in Supabase `projects` (stable id). On
 * sign-in the hydrated local draft gets pushed up and the local copy cleared,
 * so pre-sign-in work follows the user into their account.
 */
export function useAutosave(f: AutosaveFlow) {
  const { userEmail, supabase } = useSupabaseUser();
  const [lastSaved, setLastSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest values in a ref so the debounced persist() never reads stale state.
  const ref = useRef<AutosaveFlow & { userEmail: string | null; supabase: any }>(
    { ...f, userEmail, supabase }
  );
  ref.current = { ...f, userEmail, supabase };

  const persist = useCallback(async () => {
    const { snapshot: snap, launchDate, projectId, setProjectId, userEmail, supabase } =
      ref.current;
    if (!(snap.profile || snap.url)) return;

    let id = projectId;
    if (!id) {
      id = crypto.randomUUID();
      setProjectId(id);
    }

    setSaving(true);
    try {
      if (userEmail && supabase) {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) return;
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
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );
        if (!error) {
          clearDraft(); // migrated to the account
          setLastSaved(timeNow());
        }
      } else {
        saveDraft({
          id,
          url: snap.url,
          profile: snap.profile,
          strategy: snap.strategy,
          result: snap.result,
          posted: snap.posted,
          launchDate,
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
  }, [f.snapshot, f.launchDate, userEmail]);

  return { lastSaved, saving, saveNow: persist };
}
