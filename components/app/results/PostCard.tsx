"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import type { PlatformPost } from "@/lib/types";

/** One ready-to-post draft: copy, inline edit, A/B hook chips, posted mark. */
export function PostCard({
  post,
  posted,
  onTogglePosted,
  onUpdate,
}: {
  post: PlatformPost;
  posted: boolean;
  onTogglePosted: () => void;
  onUpdate: (patch: Partial<PlatformPost>) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(`${post.hook}\n\n${post.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Unique candidate hooks: the current one plus any A/B variants.
  const candidates = useMemo(
    () => Array.from(new Set([post.hook, ...(post.hookVariants || [])])).filter(Boolean),
    [post.hook, post.hookVariants]
  );
  const switchHook = (c: string) =>
    onUpdate({ hook: c, hookVariants: candidates.filter((x) => x !== c) });

  return (
    <Card className={`p-5 ${posted ? "border-emerald-800 bg-emerald-950/20" : ""}`}>
      {editing ? (
        <div className="space-y-3">
          <Field label="Hook" value={post.hook} onChange={(v) => onUpdate({ hook: v })} />
          <Field
            label="Body"
            textarea
            value={post.body}
            onChange={(v) => onUpdate({ body: v })}
          />
          <Field
            label="Image suggestion"
            value={post.imageSuggestion}
            onChange={(v) => onUpdate({ imageSuggestion: v })}
          />
          <Field
            label="Caveats"
            value={post.caveats}
            onChange={(v) => onUpdate({ caveats: v })}
          />
        </div>
      ) : (
        <>
          <div className="mb-2 text-sm font-semibold text-accent-300">{post.hook}</div>
          {candidates.length > 1 && (
            <div className="no-print mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-neutral-500">A/B hooks:</span>
              {candidates.map((c, i) => (
                <button
                  key={i}
                  onClick={() => switchHook(c)}
                  className={`rounded-md px-2 py-1 text-xs transition-colors ${
                    c === post.hook
                      ? "bg-accent-600 text-white"
                      : "bg-surface-2 text-neutral-300 hover:text-white"
                  }`}
                >
                  {c.length > 42 ? c.slice(0, 42) + "…" : c}
                </button>
              ))}
            </div>
          )}
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-neutral-200">
            {post.body}
          </pre>
          <div className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-neutral-400">
            {post.imageSuggestion && <p>🖼️ {post.imageSuggestion}</p>}
            {post.bestTime && <p>⏰ Best time: {post.bestTime}</p>}
            {post.caveats && <p>⚠️ {post.caveats}</p>}
          </div>
        </>
      )}

      <div className="no-print mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={copy}>
          {copied ? "Copied!" : "Copy"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing((e) => !e)}>
          {editing ? "Done" : "Edit"}
        </Button>
        <Button
          size="sm"
          variant={posted ? "primary" : "outline"}
          onClick={onTogglePosted}
          className={posted ? "bg-emerald-700 hover:bg-emerald-600" : ""}
        >
          {posted ? "✓ Posted" : "Mark as posted"}
        </Button>
      </div>
    </Card>
  );
}
