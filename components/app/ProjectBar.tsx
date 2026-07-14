"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { downloadFile } from "@/lib/export";
import { clearDraft } from "@/lib/storage";
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
  saveError,
  saving,
  onSaveNow,
}: {
  snapshot: ProjectSnapshot;
  onLoad: (p: SavedProject) => void;
  lastSaved: string;
  saveError: string;
  saving: boolean;
  onSaveNow: () => Promise<boolean>;
}) {
  const { userId, userEmail, displayName, supabase, updateDisplayName } = useSupabaseUser();
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [confirmProject, setConfirmProject] = useState<string | null>(null); // armed × id
  const [dataOpen, setDataOpen] = useState(false);
  const [dataMsg, setDataMsg] = useState("");
  const [dataBusy, setDataBusy] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deletePhrase, setDeletePhrase] = useState("");

  // Refresh the list on sign-in and after each autosave (so the current project shows up).
  useEffect(() => {
    if (userEmail) refresh();
    else setProjects([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, lastSaved]);

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

  // Deleting a project cascades its campaigns → experiments → outcomes →
  // tasks (schema FKs), and meta carried workspace/memory — hence the arm step.
  async function remove(id: string) {
    if (!supabase) return;
    await supabase.from("projects").delete().eq("id", id);
    setConfirmProject(null);
    refresh();
  }

  async function exportData() {
    setDataBusy(true);
    setDataMsg("");
    try {
      if (snapshot.profile || snapshot.url) {
        const saved = await onSaveNow();
        if (!saved) {
          setDataMsg("Export stopped because the current project was not saved.");
          return;
        }
      }
      downloadFile(
        "postbeacon-account-export.json",
        await api.exportAccount(),
        "application/json"
      );
      setDataMsg("Exported ✓");
    } catch (e) {
      setDataMsg((e as Error).message);
    } finally {
      setDataBusy(false);
    }
  }

  async function deleteAccount() {
    setDataBusy(true);
    setDataMsg("");
    try {
      await api.deleteAccount();
      clearDraft(); // leave nothing on this device either
      await supabase?.auth.signOut();
      window.location.assign("/app");
    } catch (e) {
      setDataMsg((e as Error).message);
      setDataBusy(false);
    }
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
        <Button
          size="sm"
          onClick={() => void onSaveNow()}
          disabled={saving || !snapshot.profile}
        >
          Save now
        </Button>
        <button
          onClick={() => supabase?.auth.signOut()}
          className="text-neutral-500 hover:text-neutral-300"
        >
          Sign out
        </button>
        <button
          onClick={() => {
            setDataOpen(!dataOpen);
            setDataMsg("");
            setDeleteArmed(false);
            setDeletePhrase("");
          }}
          className={
            dataOpen ? "text-accent-300" : "text-neutral-500 hover:text-neutral-300"
          }
        >
          Data &amp; privacy
        </button>
      </div>

      {saveError && <p className="max-w-sm text-right text-xs text-red-400">{saveError}</p>}

      {dataOpen && (
        <div className="w-64 space-y-2 rounded-md border border-line bg-surface-2 p-3 text-left text-xs">
          <button
            onClick={exportData}
            disabled={dataBusy || saving}
            className="block text-neutral-300 hover:text-accent-300 disabled:opacity-40"
          >
            Export my data (JSON)
          </button>
          {!deleteArmed ? (
            <button
              onClick={() => setDeleteArmed(true)}
              disabled={dataBusy}
              className="block text-neutral-500 hover:text-red-400 disabled:opacity-40"
            >
              Delete account…
            </button>
          ) : (
            <div className="space-y-1.5 rounded border border-red-900/60 bg-red-950/30 p-2">
              <p className="text-red-300">
                Permanently deletes every project, experiment, outcome and your account
                record. Type <span className="font-mono font-semibold">DELETE</span> to
                confirm.
              </p>
              <input
                value={deletePhrase}
                onChange={(e) => setDeletePhrase(e.target.value)}
                placeholder="DELETE"
                className="w-full rounded border border-line bg-surface px-2 py-1 outline-none focus:border-red-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={deleteAccount}
                  disabled={dataBusy || deletePhrase !== "DELETE"}
                  className="rounded bg-red-900/80 px-2 py-1 text-red-100 disabled:opacity-40"
                >
                  {dataBusy ? "Deleting…" : "Delete everything"}
                </button>
                <button
                  onClick={() => setDeleteArmed(false)}
                  disabled={dataBusy}
                  className="text-neutral-500 hover:text-neutral-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {dataMsg && <p className="text-neutral-400">{dataMsg}</p>}
          <Link href="/privacy" className="block text-neutral-600 hover:text-neutral-400">
            What we store and why →
          </Link>
        </div>
      )}

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
              {confirmProject === p.id ? (
                <>
                  <button
                    onClick={() => remove(p.id)}
                    className="font-medium text-red-400 hover:text-red-300"
                  >
                    delete?
                  </button>
                  <button
                    onClick={() => setConfirmProject(null)}
                    className="text-neutral-500 hover:text-neutral-300"
                  >
                    ·no
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmProject(p.id)}
                  title="Delete this project (and its experiments & outcomes)"
                  className="text-neutral-600 hover:text-red-400"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
