"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { GenerateResult, PlatformPost } from "@/lib/types";

export function ResultsView({
  result,
  posted,
  onTogglePosted,
  onReset,
}: {
  result: GenerateResult;
  posted: Record<string, boolean>;
  onTogglePosted: (id: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-8">
      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold">📅 Launch calendar</h2>
        <ol className="relative space-y-2 border-l border-line pl-5">
          {result.schedule.map((s, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[1.42rem] top-2 h-2 w-2 rounded-full bg-accent-500" />
              <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-4 py-2.5 text-sm">
                <span className="shrink-0 rounded-md bg-accent-700/40 px-2 py-1 text-xs font-medium text-accent-200">
                  Day {s.day}
                </span>
                <span className="text-neutral-300">{s.action}</span>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {result.content.map((c) => (
        <section key={c.platformId}>
          <h2 className="mb-3 text-lg font-semibold">{c.platformName}</h2>
          <div className="space-y-4">
            {c.posts.map((post, i) => {
              const id = `${c.platformId}-${i}`;
              return (
                <PostCard
                  key={id}
                  post={post}
                  posted={!!posted[id]}
                  onTogglePosted={() => onTogglePosted(id)}
                />
              );
            })}
          </div>
        </section>
      ))}

      <Button variant="outline" onClick={onReset}>
        ← New product
      </Button>
    </div>
  );
}

function PostCard({
  post,
  posted,
  onTogglePosted,
}: {
  post: PlatformPost;
  posted: boolean;
  onTogglePosted: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(`${post.hook}\n\n${post.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <Card className={`p-5 ${posted ? "border-emerald-800 bg-emerald-950/20" : ""}`}>
      <div className="mb-2 text-sm font-semibold text-accent-300">{post.hook}</div>
      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-neutral-200">
        {post.body}
      </pre>
      <div className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-neutral-400">
        {post.imageSuggestion && <p>🖼️ {post.imageSuggestion}</p>}
        {post.bestTime && <p>⏰ Best time: {post.bestTime}</p>}
        {post.caveats && <p>⚠️ {post.caveats}</p>}
      </div>
      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={copy}>
          {copied ? "Copied!" : "Copy"}
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
