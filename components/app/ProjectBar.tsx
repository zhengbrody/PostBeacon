"use client";

import { useEffect, useState } from "react";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

export interface ProjectSnapshot {
  url: string;
  profile: any;
  strategy: any;
  result: any;
  posted: Record<string, boolean>;
}

interface SavedProject extends ProjectSnapshot {
  id: string;
  name: string;
  updated_at: string;
}

export function ProjectBar({
  snapshot,
  onLoad,
}: {
  snapshot: ProjectSnapshot;
  onLoad: (p: SavedProject) => void;
}) {
  const supabase = getSupabase();
  const [email, setEmail] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setUserEmail(session?.user?.email ?? null)
    );
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (userEmail) refresh();
    else setProjects([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

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

  async function sendLink() {
    if (!supabase || !email) return;
    setBusy(true);
    setMsg("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + "/app" },
    });
    setBusy(false);
    setMsg(error ? error.message : "Check your email for the magic link ✉️");
  }

  async function save() {
    if (!supabase || !snapshot.profile) return;
    setBusy(true);
    setMsg("");
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("projects").insert({
      user_id: u.user!.id,
      name: snapshot.profile?.name || snapshot.url || "Untitled",
      url: snapshot.url,
      profile: snapshot.profile,
      strategy: snapshot.strategy,
      result: snapshot.result,
      posted: snapshot.posted,
    });
    setBusy(false);
    setMsg(error ? error.message : "Saved ✓");
    if (!error) refresh();
  }

  async function remove(id: string) {
    if (!supabase) return;
    await supabase.from("projects").delete().eq("id", id);
    refresh();
  }

  if (!userEmail) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs outline-none focus:border-accent-500"
        />
        <Button size="sm" onClick={sendLink} disabled={busy || !email}>
          Sign in
        </Button>
        {msg && <span className="text-xs text-neutral-400">{msg}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-neutral-400">{userEmail}</span>
        <Button size="sm" onClick={save} disabled={busy || !snapshot.profile}>
          Save project
        </Button>
        <button
          onClick={() => supabase?.auth.signOut()}
          className="text-neutral-500 hover:text-neutral-300"
        >
          Sign out
        </button>
      </div>
      {msg && <span className="text-xs text-neutral-400">{msg}</span>}
      {projects.length > 0 && (
        <div className="flex max-w-md flex-wrap justify-end gap-1.5">
          {projects.map((p) => (
            <span
              key={p.id}
              className="flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs"
            >
              <button onClick={() => onLoad(p)} className="text-neutral-300 hover:text-accent-300">
                {p.name}
              </button>
              <button onClick={() => remove(p.id)} className="text-neutral-600 hover:text-red-400">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
