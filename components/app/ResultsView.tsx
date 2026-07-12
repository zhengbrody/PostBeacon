"use client";

import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Tabs, type TabDef } from "@/components/ui/Tabs";
import { FailuresCard } from "@/components/app/results/FailuresCard";
import { OverviewTab } from "@/components/app/results/OverviewTab";
import { ContentTab } from "@/components/app/results/ContentTab";
import { CalendarTab } from "@/components/app/results/CalendarTab";
import { ExecuteTab, hasExecuteContent } from "@/components/app/results/ExecuteTab";
import { orderByRecommendation } from "@/lib/plan";
import { toMarkdown, toJson, downloadFile, type ExportSnapshot } from "@/lib/export";
import type {
  Fact,
  GenerateResult,
  MarketingStrategy,
  PlatformPost,
  PlatformRecommendation,
  ProductProfile,
  ScheduleItem,
} from "@/lib/types";

type TabId = "overview" | "content" | "calendar" | "execute";

/** The results operating dashboard: failure retries, four tabs (each its own
 *  module under results/), print force-mount, and export. Orchestration only —
 *  all tab UI lives in components/app/results/. */
export function ResultsView({
  result,
  strategy,
  profile,
  facts,
  posted,
  onTogglePosted,
  onRegenerate,
  onUpdatePost,
  onUpdateStrategy,
  onUpdateRecommendation,
  onUpdateScheduleItem,
  onRemoveScheduleItem,
  onAddScheduleItem,
  onRemoveChannel,
  onAddChannel,
  onRetryFailed,
  launchDate,
  setLaunchDate,
  loading,
  demo,
  onReset,
}: {
  result: GenerateResult;
  strategy: MarketingStrategy | null;
  profile: ProductProfile | null;
  facts: Fact[];
  posted: Record<string, boolean>;
  onTogglePosted: (id: string) => void;
  onRegenerate: (platformId: string) => void;
  onUpdatePost: (platformId: string, idx: number, patch: Partial<PlatformPost>) => void;
  onUpdateStrategy: (patch: Partial<MarketingStrategy>) => void;
  onUpdateRecommendation: (
    platformId: string,
    patch: Partial<PlatformRecommendation>
  ) => void;
  onUpdateScheduleItem: (idx: number, patch: Partial<ScheduleItem>) => void;
  onRemoveScheduleItem: (idx: number) => void;
  onAddScheduleItem: (item: ScheduleItem) => void;
  onRemoveChannel: (platformId: string) => void;
  onAddChannel: (platformId: string) => void;
  onRetryFailed: (platformId: string) => void;
  launchDate: string;
  setLaunchDate: (v: string) => void;
  loading: boolean;
  demo: boolean;
  onReset: () => void;
}) {
  function exportSnapshot(): ExportSnapshot {
    return { url: undefined, profile, strategy, result, launchDate, facts };
  }
  const slug = useMemo(
    () =>
      (profile?.name || "launch-plan")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, ""),
    [profile?.name]
  );

  // Channels in their ranked order (generate returns catalog order).
  const orderedContent = useMemo(
    () => orderByRecommendation(result.content, strategy?.recommendations),
    [strategy, result.content]
  );

  const hasExecute = hasExecuteContent(strategy);

  const tabs: TabDef[] = [
    ...(strategy ? [{ id: "overview", label: "Overview" }] : []),
    { id: "content", label: "Content", count: result.content.length },
    { id: "calendar", label: "Calendar", count: result.schedule.length },
    ...(hasExecute ? [{ id: "execute", label: "Execute" }] : []),
  ];
  const [tab, setTab] = useState<TabId>(strategy ? "overview" : "content");

  // Print / Cmd+P: force-mount every tab body so the PDF is the full plan.
  // flushSync makes React commit before the browser snapshots the page.
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  const show = (id: TabId) => printing || tab === id;

  return (
    <div className="space-y-6">
      {result.failures && result.failures.length > 0 && (
        <FailuresCard
          failures={result.failures}
          loading={loading}
          onRetry={onRetryFailed}
        />
      )}

      <Tabs tabs={tabs} active={tab} onSelect={(id) => setTab(id as TabId)} />

      {strategy && show("overview") && (
        <OverviewTab
          strategy={strategy}
          printing={printing}
          onUpdateStrategy={onUpdateStrategy}
        />
      )}

      {show("content") && (
        <ContentTab
          orderedContent={orderedContent}
          result={result}
          strategy={strategy}
          posted={posted}
          loading={loading}
          demo={demo}
          printing={printing}
          onTogglePosted={onTogglePosted}
          onRegenerate={onRegenerate}
          onUpdatePost={onUpdatePost}
          onUpdateRecommendation={onUpdateRecommendation}
          onRemoveChannel={onRemoveChannel}
          onAddChannel={onAddChannel}
        />
      )}

      {show("calendar") && (
        <CalendarTab
          schedule={result.schedule}
          launchDate={launchDate}
          setLaunchDate={setLaunchDate}
          printing={printing}
          onUpdateItem={onUpdateScheduleItem}
          onRemoveItem={onRemoveScheduleItem}
          onAddItem={onAddScheduleItem}
        />
      )}

      {hasExecute && show("execute") && strategy && (
        <ExecuteTab strategy={strategy} printing={printing} />
      )}

      <div className="no-print flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadFile(`${slug}.md`, toMarkdown(exportSnapshot()), "text/markdown")
          }
        >
          ⬇ Markdown
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadFile(`${slug}.json`, toJson(exportSnapshot()), "application/json")
          }
        >
          ⬇ JSON
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          🖨 Print / PDF
        </Button>
        <Button variant="outline" size="sm" onClick={onReset} className="ml-auto">
          ← New product
        </Button>
      </div>
    </div>
  );
}
