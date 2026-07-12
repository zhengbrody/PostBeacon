"use client";

import { useEffect, useState } from "react";
import { supabaseConfigured } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { AccountName, SignIn, useSupabaseUser } from "./SignIn";
import type { Fact, GenerateResult, MarketingStrategy, ProductProfile } from "@/lib/types";

export interface ProjectSnapshot {
  url: string;
  profile: ProductProfile | null;
  strategy: MarketingStrategy | null;
  result: GenerateResult | null;
  posted: Record<string, boolean>;
  selected: string[];
  facts: Fact[];
}

/** A `projects` row as loadProject consumes it (meta carries client state). */
interface SavedProject extends Omit<ProjectSnapshot, "selected" | "facts"> {
  id: string;
  name: string;
  updated_at: string;
  meta?: {
    schemaVersion?: number;
    selected?: string[];
    launchDate?: string;
    facts?: Fact[];
  };
}

export function ProjectBar({
  snapshot,
  onLoad,
  lastSaved,
  saving,
  onSaveNow,
}: {
  snapshot: ProjectSnapshot;
  onLoad: (p: SavedProject) => void;
  lastSaved: string;
  saving: boolean;
  onSaveNow: () => void;
}) {
  const { userEmail, displayName, supabase, updateDisplayName } = useSupabaseUser();
  const [projects, setProjects] = useState<SavedProject[]>([]);

  // Refresh the list on sign-in and after each autosave (so the current project shows up).
  useEffect(() => {
    if (userEmail) refresh();
    else setProjects([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail, lastSaved]);

  if (!supabaseConfigured()) {
    return (
      <p className="max-w-[14rem] text-right text-xs text-neutral-600">
        Add Supabase keys to enable accounts & saved projects.
      </p>
    );
  }

  async function refresh() {
    if (!supabase) return;
    const { data } = await supabase
      .from("projects")
      .select("*")
      .order("updated_at", { ascending: false });
    setProjects((data as SavedProject[]) || []);
  }

  async function remove(id: string) {
    if (!supabase) return;
    await supabase.from("projects").delete().eq("id", id);
    refresh();
  }

  if (!userEmail) {
    return <SignIn redirectTo="/app" />;
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 text-xs">
        <AccountName email={userEmail} name={displayName} onSave={updateDisplayName} />
        <span className="text-neutral-500">
          {saving ? "Saving…" : lastSaved ? `Saved ✓ ${lastSaved}` : ""}
        </span>
        <Button size="sm" onClick={onSaveNow} disabled={saving || !snapshot.profile}>
          Save now
        </Button>
        <button
          onClick={() => supabase?.auth.signOut()}
          className="text-neutral-500 hover:text-neutral-300"
        >
          Sign out
        </button>
      </div>
      {projects.length > 0 && (
        <div className="flex max-w-md flex-wrap justify-end gap-1.5">
          {projects.map((p) => (
            <span
              key={p.id}
              className="flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs"
            >
              <button
                onClick={() => onLoad(p)}
                className="text-neutral-300 hover:text-accent-300"
              >
                {p.name}
              </button>
              <button
                onClick={() => remove(p.id)}
                className="text-neutral-600 hover:text-red-400"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
