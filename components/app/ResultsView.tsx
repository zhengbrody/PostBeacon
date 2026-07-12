"use client";

import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { Tabs, type TabDef } from "@/components/ui/Tabs";
import { FailuresCard } from "@/components/app/results/FailuresCard";
import { TodayTab } from "@/components/app/results/TodayTab";
import { PlanReport } from "@/components/app/results/PlanReport";
import { TimelineTab } from "@/components/app/results/TimelineTab";
import { ReviewTab } from "@/components/app/results/ReviewTab";
import { PublishDialog, type PublishDetails } from "@/components/app/results/PublishDialog";
import { OutcomePanel } from "@/components/app/results/OutcomePanel";
import { deriveToday, type TodayAction } from "@/lib/today";
import type {
  Experiment,
  Fact,
  GenerateResult,
  MarketingStrategy,
  Outcome,
  OutcomeCheckpoint,
  PlatformPost,
  PlatformRecommendation,
  ProductProfile,
  ScheduleItem,
  TaskRecord,
  WorkspaceState,
} from "@/lib/types";

type Surface = "today" | "plan" | "timeline" | "review";

/**
 * The launch workspace (M15). Post-generation home is TODAY — at most three
 * actions; the full report, timeline, and weekly review each live one tap
 * away (progressive disclosure: nothing is inlined into Today). Publishing
 * and outcome dialogs are the only overlays, opened by their own actions.
 */
export function ResultsView({
  result,
  strategy,
  profile,
  facts,
  workspace,
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
  onActTask,
  onPublishExperiment,
  onRecordOutcome,
  onStopExperiment,
  onGenerateVariant,
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
  workspace: WorkspaceState;
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
  onActTask: (record: TaskRecord) => void;
  onPublishExperiment: (experiment: Experiment, taskId?: string) => void;
  onRecordOutcome: (experimentId: string, outcome: Outcome) => void;
  onStopExperiment: (experimentId: string) => void;
  onGenerateVariant: (experiment: Experiment) => void;
  launchDate: string;
  setLaunchDate: (v: string) => void;
  loading: boolean;
  demo: boolean;
  onReset: () => void;
}) {
  const [surface, setSurface] = useState<Surface>("today");
  const [publishFor, setPublishFor] = useState<{
    platformId: string;
    postIdx: number;
  } | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<{
    experimentId: string;
    checkpoint: OutcomeCheckpoint;
  } | null>(null);

  const today = useMemo(
    () => deriveToday({ launchDate, strategy, result, workspace }, new Date()),
    [launchDate, strategy, result, workspace]
  );

  // Print / Cmd+P: force-mount the FULL report so the PDF is the whole plan.
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

  const surfaces: TabDef[] = [
    {
      id: "today",
      label: "Today",
      ...(today.dueRecordCount ? { count: today.dueRecordCount } : {}),
    },
    { id: "plan", label: "Full plan" },
    { id: "timeline", label: "Timeline" },
    { id: "review", label: "Review" },
  ];

  const publishContent = publishFor
    ? result.content.find((c) => c.platformId === publishFor.platformId)
    : undefined;
  const outcomeExperiment = outcomeFor
    ? workspace.experiments.find((e) => e.id === outcomeFor.experimentId)
    : undefined;

  function confirmPublish(details: PublishDetails) {
    if (!publishContent) return;
    const rec = strategy?.recommendations.find(
      (r) => r.platformId === publishContent.platformId
    );
    const goal = profile?.conversionGoal || "conversion";
    const experiment: Experiment = {
      id: crypto.randomUUID(),
      platformId: publishContent.platformId,
      platformName: publishContent.platformName,
      community: details.community,
      angle: details.angle || rec?.angle || "",
      variant: details.variant,
      hypothesis: `"${details.angle || rec?.angle || "this angle"}" on ${
        details.community || publishContent.platformName
      } will produce ${goal} signal within 72h`,
      trackedUrl: details.trackedUrl || undefined,
      publishedAt: new Date().toISOString(),
      status: "live",
      postIdx: details.postIdx,
      outcomes: [],
    };
    onPublishExperiment(experiment, `post:${publishContent.platformId}`);
    setPublishFor(null);
  }

  const skipTask = (a: TodayAction) =>
    onActTask({
      id: a.id,
      kind: a.kind === "record" ? "record" : a.kind === "post" ? "post" : "custom",
      title: a.title,
      status: "skipped",
      estMinutes: a.estMinutes,
      at: new Date().toISOString(),
    });

  const doneCustom = (a: TodayAction) =>
    onActTask({
      id: a.id,
      kind: "custom",
      title: a.title,
      status: "done",
      estMinutes: a.estMinutes,
      at: new Date().toISOString(),
    });

  return (
    <div className="space-y-6">
      {result.failures && result.failures.length > 0 && (
        <FailuresCard
          failures={result.failures}
          loading={loading}
          onRetry={onRetryFailed}
        />
      )}

      <div className="no-print">
        <Tabs
          tabs={surfaces}
          active={surface}
          onSelect={(id) => setSurface(id as Surface)}
        />
      </div>

      {surface === "today" && !printing && (
        <TodayTab
          view={today}
          loading={loading}
          onPublish={(platformId) => {
            const content = result.content.find((c) => c.platformId === platformId);
            const firstUnposted =
              content?.posts.findIndex((_, i) => !posted[`${platformId}-${i}`]) ?? 0;
            setPublishFor({ platformId, postIdx: Math.max(0, firstUnposted) });
          }}
          onRecord={(a) => {
            if (a.experimentId && a.checkpoint) {
              setOutcomeFor({ experimentId: a.experimentId, checkpoint: a.checkpoint });
            }
          }}
          onSkip={skipTask}
          onDoneCustom={doneCustom}
          onOpenContent={() => setSurface("plan")}
          onOpenReview={() => setSurface("review")}
        />
      )}

      {(surface === "plan" || printing) && (
        <PlanReport
          result={result}
          strategy={strategy}
          profile={profile}
          facts={facts}
          posted={posted}
          onTogglePosted={onTogglePosted}
          onRegenerate={onRegenerate}
          onUpdatePost={onUpdatePost}
          onUpdateStrategy={onUpdateStrategy}
          onUpdateRecommendation={onUpdateRecommendation}
          onUpdateScheduleItem={onUpdateScheduleItem}
          onRemoveScheduleItem={onRemoveScheduleItem}
          onAddScheduleItem={onAddScheduleItem}
          onRemoveChannel={onRemoveChannel}
          onAddChannel={onAddChannel}
          onRequestPublish={(platformId, postIdx) => setPublishFor({ platformId, postIdx })}
          printing={printing}
          launchDate={launchDate}
          setLaunchDate={setLaunchDate}
          loading={loading}
          demo={demo}
          onReset={onReset}
        />
      )}

      {surface === "timeline" && !printing && <TimelineTab workspace={workspace} />}

      {surface === "review" && !printing && (
        <ReviewTab workspace={workspace} strategy={strategy} />
      )}

      {publishFor && publishContent && (
        <PublishDialog
          content={publishContent}
          rec={strategy?.recommendations.find(
            (r) => r.platformId === publishFor.platformId
          )}
          defaultPostIdx={publishFor.postIdx}
          onConfirm={confirmPublish}
          onClose={() => setPublishFor(null)}
        />
      )}

      {outcomeFor && outcomeExperiment && (
        <OutcomePanel
          experiment={outcomeExperiment}
          checkpoint={outcomeFor.checkpoint}
          strategy={strategy}
          loading={loading}
          onSave={(outcome) => onRecordOutcome(outcomeExperiment.id, outcome)}
          onGenerateVariant={() => onGenerateVariant(outcomeExperiment)}
          onStop={() => onStopExperiment(outcomeExperiment.id)}
          onClose={() => setOutcomeFor(null)}
        />
      )}
    </div>
  );
}
