"use client";

import { useEffect, useState } from "react";
import { api, type UsageInfo } from "@/lib/api";

// Tiny "N free launches left" / "Pro" indicator. Renders nothing when metering
// is off or the user is signed out. Re-fetches when `refreshKey` changes.
export function UsageBadge({ refreshKey }: { refreshKey?: unknown }) {
  const [info, setInfo] = useState<UsageInfo | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .usage()
      .then((u) => alive && setInfo(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (!info?.enabled || !info.signedIn) return null;

  if (info.plan === "pro") {
    return (
      <span className="rounded-md bg-accent-600/20 px-2 py-1 text-xs text-accent-200">
        Pro · unlimited
      </span>
    );
  }

  const left = info.remaining ?? 0;
  return (
    <span className="rounded-md bg-surface-2 px-2 py-1 text-xs text-neutral-400">
      {left} free launch{left === 1 ? "" : "es"} left
    </span>
  );
}
