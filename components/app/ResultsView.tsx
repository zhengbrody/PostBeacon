"use client";

import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { Tabs, type TabDef } from "@/components/ui/Tabs";
import { FailuresCard } from "@/components/app/results/FailuresCard";
import { TodayTab } from "@/components/app/results/TodayTab";
import { PlanReport } from "@/components/app/results/PlanReport";
import { TimelineTab } from "@/components/app/results/TimelineTab";
import { ReviewTab } from "@/components/app/results/ReviewTab";
import { DemoGuide, type DemoGuideStep } from "@/components/app/DemoGuide";
import { PublishDialog, type PublishDetails } from "@/components/app/results/PublishDialog";
import { OutcomePanel } from "@/components/app/results/OutcomePanel";
import { deriveToday, type TodayAction } from "@/lib/today";
import { latestRelevantExperiment } from "@/lib/execution";
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
  ProductMemory,
  WorkspaceState,
} from "@/lib/types";

type Surface = "today" | "plan" | "timeline" | "review";

/**
 * The M19 execution workspace. Today owns Prepare → Publish → Measure → Learn;
 * Strategy, Progress and Learn & next are projections/reference surfaces.
 */
export function ResultsView({
  result,
  strategy,
  profile,
  facts,
  workspace,
  memory,
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
  onAskCopilot,
  emailRemindersAvailable,
  onToggleEmailReminders,
}: {
  result: GenerateResult;
  strategy: MarketingStrategy | null;
  profile: ProductProfile | null;
  facts: Fact[];
  workspace: WorkspaceState;
  memory: ProductMemory;
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
  onAskCopilot: (prompt: string, targetPlatformId?: string) => void;
  emailRemindersAvailable: boolean;
  onToggleEmailReminders: (enabled: boolean, timezone?: string) => void;
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
  const [notice, setNotice] = useState<{ title: string; detail: string } | null>(null);
  const [demoGuideOpen, setDemoGuideOpen] = useState(demo);
  const [demoPrepared, setDemoPrepared] = useState(false);

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
    { id: "plan", label: "Strategy library", shortLabel: "Strategy" },
    { id: "timeline", label: "Progress" },
    { id: "review", label: "Learn & next", shortLabel: "Learn" },
  ];

  const publishContent = publishFor
    ? result.content.find((c) => c.platformId === publishFor.platformId)
    : undefined;
  const outcomeExperiment = outcomeFor
    ? workspace.experiments.find((e) => e.id === outcomeFor.experimentId)
    : undefined;
  const activeExperiment = useMemo(() => latestRelevantExperiment(workspace), [workspace]);
  const demoStep: DemoGuideStep =
    !demoPrepared && !activeExperiment
      ? "prepare"
      : !activeExperiment
        ? "publish"
        : activeExperiment.outcomes.length === 0
          ? "measure"
          : "learn";
  const primaryExperiment = today.primaryAction.experimentId
    ? workspace.experiments.find(
        (experiment) => experiment.id === today.primaryAction.experimentId
      )
    : undefined;
  const primaryContent = today.primaryAction.platformId
    ? result.content.find(
        (content) => content.platformId === today.primaryAction.platformId
      )
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
    setNotice({
      title: demo
        ? `${publishContent.platformName} example experiment started`
        : `${publishContent.platformName} experiment started`,
      detail: demo
        ? "Simulated publish only. The temporary workspace is now ready for an example result."
        : `Publish saved. The first useful result check opens ${new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toLocaleString()}; Progress and Weekly Review now follow this experiment.`,
    });
    setPublishFor(null);
    setOutcomeFor(null);
    setSurface("today");
  }

  function demoGuideAction(step: DemoGuideStep) {
    if (!demo) return;
    if (step === "prepare") {
      setSurface("today");
      setDemoPrepared(true);
      setNotice({
        title: "Example draft ready",
        detail:
          "Review the evidence-backed draft below, then try the publish confirmation.",
      });
      return;
    }
    if (step === "publish") {
      const platformId = today.primaryAction.platformId ?? result.content[0]?.platformId;
      if (platformId) setPublishFor({ platformId, postIdx: 0 });
      return;
    }
    if (step === "measure" && activeExperiment) {
      onRecordOutcome(activeExperiment.id, {
        id: crypto.randomUUID(),
        checkpoint: "24h",
        recordedAt: new Date().toISOString(),
        impressions: 640,
        replies: 5,
        clicks: 24,
        signups: 4,
        qualitativeFeedback:
          "Example result: replies focused on the one-line setup and self-host option.",
      });
      setSurface("review");
      setNotice({
        title: "Example result recorded",
        detail:
          "The verdict and next experiment now come from the same temporary workspace state.",
      });
      return;
    }
    if (step === "learn") {
      setSurface("review");
      setDemoGuideOpen(false);
    }
  }

  const demoOnlyNotice = (action: string) =>
    setNotice({
      title: `${action} is paused in the example`,
      detail:
        "The walkthrough never calls a model or saves data. Sign in and use your own project for live generation.",
    });

  const skipTask = (a: TodayAction) => {
    onActTask({
      id: a.id,
      kind: a.kind === "record" ? "record" : a.kind === "post" ? "post" : "custom",
      title: a.title,
      status: "skipped",
      estMinutes: a.estMinutes,
      at: new Date().toISOString(),
    });
    setNotice({
      title: "Move skipped",
      detail: "The workspace recalculated the next best available move.",
    });
  };

  const doneCustom = (a: TodayAction) => {
    onActTask({
      id: a.id,
      kind: "custom",
      title: a.title,
      status: "done",
      estMinutes: a.estMinutes,
      at: new Date().toISOString(),
    });
    setNotice({
      title: "Task completed",
      detail: "Progress saved and the next move is ready.",
    });
  };

  const recordEditor =
    outcomeExperiment && outcomeFor ? (
      <OutcomePanel
        mode="inline"
        experiment={outcomeExperiment}
        checkpoint={outcomeFor.checkpoint}
        strategy={strategy}
        loading={loading}
        onSave={(outcome) => onRecordOutcome(outcomeExperiment.id, outcome)}
        onGenerateVariant={() =>
          demo ? demoOnlyNotice("Variant generation") : onGenerateVariant(outcomeExperiment)
        }
        onStop={() => onStopExperiment(outcomeExperiment.id)}
        onClose={() => setOutcomeFor(null)}
      />
    ) : undefined;

  return (
    <div className="space-y-6">
      {demo && demoGuideOpen && (
        <DemoGuide
          currentStep={demoStep}
          onPrimaryAction={demoGuideAction}
          onSkip={() => setDemoGuideOpen(false)}
          onClose={() => setDemoGuideOpen(false)}
          busy={loading}
        />
      )}

      {result.failures && result.failures.length > 0 && (
        <FailuresCard
          failures={result.failures}
          loading={loading}
          onRetry={demo ? () => demoOnlyNotice("Live generation") : onRetryFailed}
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
          productName={profile?.name}
          primaryGoal={profile?.conversionGoal}
          facts={facts}
          profile={profile}
          loading={loading}
          onPublish={(platformId, requestedPostIdx) => {
            const content = result.content.find((c) => c.platformId === platformId);
            const firstUnposted =
              content?.posts.findIndex((_, i) => !posted[`${platformId}-${i}`]) ?? 0;
            setPublishFor({
              platformId,
              postIdx: requestedPostIdx ?? Math.max(0, firstUnposted),
            });
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
          onAskCopilot={(action, direction) => {
            if (demo) return demoOnlyNotice("Copilot");
            onAskCopilot(
              direction
                ? `My current next best move is “${action.title}”. ${direction} Use evidence from my plan and propose only changes I can review before applying.`
                : `Help me execute my current next best move: “${action.title}”. Explain the sharpest way to do it for this product, use evidence from my plan, and propose only changes I can review before applying.`,
              action.platformId
            );
          }}
          onRegenerate={demo ? () => demoOnlyNotice("Regeneration") : onRegenerate}
          onUpdatePost={onUpdatePost}
          primaryContent={primaryContent}
          posted={posted}
          activeExperiment={activeExperiment}
          primaryExperiment={primaryExperiment}
          notice={notice}
          onDismissNotice={() => setNotice(null)}
          recordEditor={recordEditor}
          onAskExperiment={(experiment) => {
            if (demo) return demoOnlyNotice("Copilot");
            onAskCopilot(
              `For my active ${experiment.platformName} experiment, tell me exactly what to measure at the next check-in and how each signal changes the decision. Do not invent results.`,
              experiment.platformId
            );
          }}
          onRecordEarly={(experiment) =>
            setOutcomeFor({ experimentId: experiment.id, checkpoint: "manual" })
          }
          onOpenProgress={() => setSurface("timeline")}
          emailRemindersAvailable={emailRemindersAvailable}
          emailRemindersEnabled={workspace.reminderPreferences?.email === true}
          onToggleEmailReminders={(enabled) =>
            onToggleEmailReminders(
              enabled,
              typeof Intl !== "undefined"
                ? Intl.DateTimeFormat().resolvedOptions().timeZone
                : undefined
            )
          }
        />
      )}

      {(surface === "plan" || printing) && (
        <PlanReport
          result={result}
          strategy={strategy}
          profile={profile}
          facts={facts}
          workspace={workspace}
          memory={memory}
          posted={posted}
          onTogglePosted={onTogglePosted}
          onRegenerate={demo ? () => demoOnlyNotice("Regeneration") : onRegenerate}
          onUpdatePost={onUpdatePost}
          onUpdateStrategy={onUpdateStrategy}
          onUpdateRecommendation={onUpdateRecommendation}
          onUpdateScheduleItem={onUpdateScheduleItem}
          onRemoveScheduleItem={onRemoveScheduleItem}
          onAddScheduleItem={onAddScheduleItem}
          onRemoveChannel={onRemoveChannel}
          onAddChannel={demo ? () => demoOnlyNotice("Live generation") : onAddChannel}
          onRequestPublish={(platformId, postIdx) => setPublishFor({ platformId, postIdx })}
          printing={printing}
          launchDate={launchDate}
          setLaunchDate={setLaunchDate}
          loading={loading}
          demo={demo}
          onReset={onReset}
        />
      )}

      {surface === "timeline" && !printing && (
        <TimelineTab workspace={workspace} activeExperiment={activeExperiment} />
      )}

      {surface === "review" && !printing && (
        <ReviewTab
          workspace={workspace}
          strategy={strategy}
          onGoToday={() => setSurface("today")}
          onRecord={(experimentId, checkpoint) => {
            setOutcomeFor({ experimentId, checkpoint });
            setSurface("today");
          }}
          onSchedule={(platformId) => {
            const content = result.content.find(
              (candidate) => candidate.platformId === platformId
            );
            if (content?.posts.length) {
              setPublishFor({ platformId, postIdx: 0 });
            } else {
              onAddChannel(platformId);
              setSurface("plan");
            }
          }}
        />
      )}

      {publishFor && publishContent && profile && (
        <PublishDialog
          content={publishContent}
          facts={facts}
          profile={profile}
          rec={strategy?.recommendations.find(
            (r) => r.platformId === publishFor.platformId
          )}
          defaultPostIdx={publishFor.postIdx}
          demo={demo}
          onConfirm={confirmPublish}
          onClose={() => setPublishFor(null)}
        />
      )}
    </div>
  );
}
