"use client";

import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { Tabs, type TabDef } from "@/components/ui/Tabs";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { GrowthAgentControls } from "@/hooks/useGrowthAgent";
import { FailuresCard } from "@/components/app/results/FailuresCard";
import { TodayTab } from "@/components/app/results/TodayTab";
import { PlanReport } from "@/components/app/results/PlanReport";
import { TimelineTab } from "@/components/app/results/TimelineTab";
import { normalizeTrackedUrl } from "@/lib/trackedUrl";
import { postTaskId } from "@/lib/experimentIdentity";
import { ReviewTab } from "@/components/app/results/ReviewTab";
import { DemoGuide, type DemoGuideStep } from "@/components/app/DemoGuide";
import { PublishDialog, type PublishDetails } from "@/components/app/results/PublishDialog";
import { OutcomePanel } from "@/components/app/results/OutcomePanel";
import { OpportunityWorkbench } from "@/components/app/results/OpportunityWorkbench";
import { DailyResearchMission } from "@/components/app/results/DailyResearchMission";
import { deriveToday, type TodayAction } from "@/lib/today";
import { latestRelevantExperiment } from "@/lib/execution";
import { researchContextKey } from "@/lib/opportunityResearch";
import { trialDraftIssues } from "@/lib/trialDraftSafety";
import { auditDraftSafety } from "@/lib/contentSafety";
import { successContractSummary } from "@/lib/successContract";
import {
  NextExperimentChoices,
  PlannedExperimentQueue,
} from "@/components/app/results/NextExperimentChoices";
import type {
  Experiment,
  AnalysisReceipt,
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
  PlannedExperiment,
  Provider,
  TrialResearchInput,
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
  analysisReceipt,
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
  onPlanExperiment,
  onPreparePlanned,
  onCancelPlanned,
  productUrl,
  provider,
  onResearchOpportunities,
  onClearOpportunityResearch,
  onQueueOpportunity,
  growthAgent,
  onReviewAgent,
  projectId,
  ownerId,
  onCompleteSetup,
  onSaveProject,
}: {
  result: GenerateResult;
  strategy: MarketingStrategy | null;
  profile: ProductProfile | null;
  facts: Fact[];
  analysisReceipt: AnalysisReceipt | null;
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
  onAskCopilot: (prompt: string, targetPlatformId?: string, postIdx?: number) => void;
  emailRemindersAvailable: boolean;
  onToggleEmailReminders: (enabled: boolean, timezone?: string) => void;
  onPlanExperiment: (plan: PlannedExperiment) => void;
  onPreparePlanned: (id: string) => void;
  onCancelPlanned: (id: string) => void;
  productUrl?: string;
  provider: Provider;
  onResearchOpportunities: (input: TrialResearchInput, deepseekConsent?: boolean) => void;
  growthAgent: GrowthAgentControls;
  onReviewAgent: (id: string) => void;
  projectId: string;
  ownerId?: string | null;
  onCompleteSetup: () => void;
  onSaveProject: () => Promise<boolean>;
  onClearOpportunityResearch: () => void;
  onQueueOpportunity: (
    researchId: string,
    opportunityId: string,
    rulesChecked: boolean,
    trialChecked: boolean
  ) => void;
}) {
  const [surface, setSurface] = useState<Surface>("today");
  const [publishFor, setPublishFor] = useState<{
    platformId: string;
    postIdx: number;
    plannedExperimentId?: string;
  } | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<{
    experimentId: string;
    checkpoint: OutcomeCheckpoint;
  } | null>(null);
  const [notice, setNotice] = useState<{ title: string; detail: string } | null>(null);
  const [demoGuideOpen, setDemoGuideOpen] = useState(demo);
  const [demoPrepared, setDemoPrepared] = useState(false);
  const [focusedPlanId, setFocusedPlanId] = useState<string>();
  const [pendingPublish, setPendingPublish] = useState<{
    id: string;
    platformName: string;
  }>();
  useEffect(() => {
    if (!pendingPublish) return;
    const saved = workspace.experiments.find((item) => item.id === pendingPublish.id);
    if (!saved) return;
    setNotice({
      title: demo
        ? `${pendingPublish.platformName} example experiment started`
        : `${pendingPublish.platformName} experiment started`,
      detail: demo
        ? "Simulated publish only. The temporary workspace is now ready for an example result."
        : `Publish recorded in this workspace. The first useful result check opens ${new Date(Date.parse(saved.publishedAt) + 24 * 60 * 60 * 1000).toLocaleString()}; cloud save status is shown separately.`,
    });
    setPendingPublish(undefined);
    setPublishFor(null);
    setOutcomeFor(null);
    setSurface("today");
    setFocusedPlanId(undefined);
  }, [pendingPublish, workspace.experiments, demo]);

  const derivedToday = useMemo(
    () => deriveToday({ launchDate, strategy, result, workspace }, new Date()),
    [launchDate, strategy, result, workspace]
  );
  const focusedPlan = workspace.plannedExperiments?.find(
    (item) => item.id === focusedPlanId && item.status === "ready"
  );
  const today = focusedPlan
    ? {
        ...derivedToday,
        primaryAction: {
          id: `planned:${focusedPlan.id}`,
          kind: "post" as const,
          title: `Review next experiment — ${focusedPlan.platformName}`,
          whyNow: focusedPlan.heldConstant,
          estMinutes: 20,
          due: true,
          platformId: focusedPlan.platformId,
          postIdx: focusedPlan.postIdx,
          plannedExperimentId: focusedPlan.id,
        },
      }
    : derivedToday;
  const primaryPlan = workspace.plannedExperiments?.find(
    (item) => item.id === today.primaryAction.plannedExperimentId
  );
  const currentTrialContextKey =
    profile && workspace.successContract && productUrl
      ? researchContextKey(
          profile,
          facts,
          workspace.successContract,
          productUrl,
          memory.bannedClaims
        )
      : undefined;

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
  const primaryRecommendation = today.primaryAction.platformId
    ? strategy?.recommendations.find(
        (recommendation) => recommendation.platformId === today.primaryAction.platformId
      )
    : undefined;

  function requestPublish(platformId: string, requestedPostIdx?: number) {
    const content = result.content.find((item) => item.platformId === platformId);
    const postIdx =
      requestedPostIdx ??
      Math.max(
        0,
        content?.posts.findIndex((_, index) => !posted[`${platformId}-${index}`]) ?? 0
      );
    const plan = workspace.plannedExperiments?.find(
      (item) =>
        item.status === "ready" &&
        item.platformId === platformId &&
        item.postIdx === postIdx
    );
    setPublishFor({ platformId, postIdx, plannedExperimentId: plan?.id });
  }

  function confirmPublish(details: PublishDetails) {
    if (!publishContent || pendingPublish) return;
    const draft = publishContent.posts[details.postIdx];
    if (
      !draft ||
      !profile ||
      !auditDraftSafety(draft, facts, profile, publishContent.platformId).ready ||
      workspace.experiments.some(
        (item) =>
          item.platformId === publishContent.platformId && item.postIdx === details.postIdx
      ) ||
      trialDraftIssues(
        publishContent.platformId,
        details.postIdx,
        draft,
        workspace.plannedExperiments,
        currentTrialContextKey,
        memory.bannedClaims
      ).length
    )
      return;
    const rec = strategy?.recommendations.find(
      (r) => r.platformId === publishContent.platformId
    );
    const plan = workspace.plannedExperiments?.find(
      (item) => item.id === publishFor?.plannedExperimentId
    );
    const successContract = plan?.successContract ?? workspace.successContract;
    const goal = successContract?.primaryGoal || profile?.conversionGoal || "conversion";
    const experiment: Experiment = {
      id: crypto.randomUUID(),
      platformId: publishContent.platformId,
      platformName: publishContent.platformName,
      community: details.community,
      angle: details.angle || rec?.angle || "",
      variant: details.variant,
      hypothesis: `"${details.angle || rec?.angle || "this angle"}" on ${
        details.community || publishContent.platformName
      } will produce ${goal} signal${
        successContract ? ` (${successContractSummary(successContract)})` : " within 72h"
      }`,
      trackedUrl: normalizeTrackedUrl(details.trackedUrl),
      publishedAt: new Date().toISOString(),
      status: "live",
      postIdx: details.postIdx,
      outcomes: [],
      successContract,
      plannedExperimentId: plan?.id,
      snapshot: {
        audience: profile?.audience ?? "",
        publisherVoice: profile?.publisherVoice ?? "brand",
        facts,
        draft: publishContent.posts[details.postIdx],
        variable: details.variable,
        heldConstant: details.heldConstant,
        successContract,
      },
    };
    onPublishExperiment(experiment, postTaskId(publishContent.platformId, details.postIdx));
    setPendingPublish({ id: experiment.id, platformName: publishContent.platformName });
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
      if (platformId) requestPublish(platformId, 0);
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
    if (a.plannedExperimentId) {
      onCancelPlanned(a.plannedExperimentId);
      setFocusedPlanId(undefined);
      setNotice({
        title: "Planned experiment cancelled",
        detail: "The published history and other experiments remain unchanged.",
      });
      return;
    }
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
        nextExperimentControls={
          <NextExperimentChoices
            experiment={outcomeExperiment}
            evidenceState={
              memory.angles.find((item) => item.experimentId === outcomeExperiment.id)
                ?.evidenceState
            }
            strategy={strategy}
            queue={workspace.plannedExperiments ?? []}
            loading={loading}
            onPlan={(plan) => {
              onPlanExperiment(plan);
              setOutcomeFor(null);
              setNotice({
                title: "Next experiment confirmed",
                detail: `${plan.platformName} · ${plan.variable}. Saved in your queue; preparing a draft is a separate action.`,
              });
            }}
            onStop={() => onStopExperiment(outcomeExperiment.id)}
          />
        }
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

      {surface === "today" &&
        !printing &&
        (profile && workspace.successContract && productUrl && (demo || projectId) ? (
          <>
            <DailyResearchMission
              key={`daily:${ownerId ?? ""}:${projectId}:${demo}`}
              ownerId={ownerId}
              projectId={projectId}
              demo={demo}
              profile={profile}
              facts={facts}
              contract={workspace.successContract}
              productUrl={productUrl}
              bannedClaims={memory.bannedClaims}
              initialBrief={workspace.opportunityResearch?.input}
              onRunsChanged={growthAgent.refresh}
            />
            <OpportunityWorkbench
              key={`${projectId}:${productUrl}:${demo}`}
              profile={profile}
              facts={facts}
              contract={workspace.successContract}
              bannedClaims={memory.bannedClaims}
              productUrl={productUrl}
              provider={provider}
              research={workspace.opportunityResearch}
              queue={workspace.plannedExperiments ?? []}
              draftCounts={Object.fromEntries(
                result.content.map((c) => [c.platformId, c.posts.length])
              )}
              loading={loading}
              demo={demo}
              agent={growthAgent}
              onReviewAgent={onReviewAgent}
              onResearch={onResearchOpportunities}
              onClear={onClearOpportunityResearch}
              onQueue={(researchId, opportunityId, rulesChecked, trialChecked) => {
                onQueueOpportunity(researchId, opportunityId, rulesChecked, trialChecked);
                setFocusedPlanId(opportunityId);
              }}
            />
          </>
        ) : (
          <Card className="p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent-300">
              Growth Agent
            </p>
            <h3 className="mt-2 text-xl font-semibold">
              Give your next experiment a clear goal
            </h3>
            <p className="my-3 text-sm text-neutral-400">
              {!workspace.successContract || !profile || !productUrl
                ? "This saved plan needs a product profile and success definition before preparing a CMO trial kit. Your old plan is preserved."
                : "Save this project to your account before starting a persistent task. No research runs in the background yet."}
            </p>
            {!workspace.successContract || !profile || !productUrl ? (
              <Button onClick={onCompleteSetup}>Complete experiment setup →</Button>
            ) : (
              <Button onClick={() => void onSaveProject()}>Save project first →</Button>
            )}
          </Card>
        ))}

      {surface === "today" && !printing && (
        <TodayTab
          view={today}
          productName={profile?.name}
          primaryGoal={profile?.conversionGoal}
          successContract={workspace.successContract}
          productUrl={productUrl}
          primaryPlan={primaryPlan}
          currentTrialContextKey={currentTrialContextKey}
          trialPlans={workspace.plannedExperiments}
          bannedClaims={memory.bannedClaims}
          onPreparePlanned={onPreparePlanned}
          facts={facts}
          profile={profile}
          loading={loading}
          onPublish={requestPublish}
          onRecord={(a) => {
            if (a.experimentId && a.checkpoint) {
              setOutcomeFor({ experimentId: a.experimentId, checkpoint: a.checkpoint });
            }
          }}
          onSkip={skipTask}
          onDoneCustom={doneCustom}
          onOpenContent={() => setSurface("plan")}
          onOpenReview={() => setSurface("review")}
          onAskCopilot={(action, direction, postIdx) => {
            if (demo) return demoOnlyNotice("Copilot");
            onAskCopilot(
              direction
                ? `My current next best move is “${action.title}”. ${direction} Use evidence from my plan and propose only changes I can review before applying.`
                : `Help me execute my current next best move: “${action.title}”. Explain the sharpest way to do it for this product, use evidence from my plan, and propose only changes I can review before applying.`,
              action.platformId,
              postIdx
            );
          }}
          onRegenerate={demo ? () => demoOnlyNotice("Regeneration") : onRegenerate}
          onUpdatePost={onUpdatePost}
          primaryContent={primaryContent}
          primaryRecommendation={
            primaryPlan && primaryRecommendation
              ? {
                  ...primaryRecommendation,
                  angle: primaryPlan.angle,
                  venue: primaryPlan.venue,
                }
              : primaryRecommendation
          }
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

      {(surface === "today" || surface === "review") && !printing && (
        <PlannedExperimentQueue
          queue={workspace.plannedExperiments ?? []}
          loading={loading}
          demo={demo}
          onPrepare={onPreparePlanned}
          onOpen={(plan) => {
            setFocusedPlanId(plan.id);
            setSurface("today");
            setOutcomeFor(null);
          }}
          onCancel={(id) => {
            onCancelPlanned(id);
            setFocusedPlanId(undefined);
            setNotice({
              title: "Planned experiment cancelled",
              detail:
                "No post or historical result was changed. Your remaining queue is preserved.",
            });
          }}
        />
      )}

      {(surface === "plan" || printing) && (
        <PlanReport
          currentTrialContextKey={currentTrialContextKey}
          result={result}
          strategy={strategy}
          profile={profile}
          facts={facts}
          analysisReceipt={analysisReceipt}
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
          onRequestPublish={requestPublish}
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
        <>
          {activeExperiment && activeExperiment.outcomes.length > 0 && (
            <NextExperimentChoices
              experiment={activeExperiment}
              evidenceState={
                memory.angles.find((item) => item.experimentId === activeExperiment.id)
                  ?.evidenceState
              }
              strategy={strategy}
              queue={workspace.plannedExperiments ?? []}
              loading={loading}
              onPlan={(plan) => {
                onPlanExperiment(plan);
                setOutcomeFor(null);
                setSurface("today");
                setNotice({
                  title: "Next experiment confirmed",
                  detail:
                    "Your decision is queued. Prepare the draft when ready; publishing remains manual.",
                });
              }}
              onStop={() => onStopExperiment(activeExperiment.id)}
            />
          )}
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
                requestPublish(platformId, 0);
              } else {
                onAddChannel(platformId);
                setSurface("plan");
              }
            }}
          />
        </>
      )}

      {publishFor && publishContent && profile && (
        <PublishDialog
          recording={Boolean(pendingPublish)}
          content={publishContent}
          facts={facts}
          profile={profile}
          bannedClaims={memory.bannedClaims}
          currentTrialContextKey={currentTrialContextKey}
          trialPlans={workspace.plannedExperiments}
          successContract={
            workspace.plannedExperiments?.find(
              (item) => item.id === publishFor.plannedExperimentId
            )?.successContract ?? workspace.successContract
          }
          rec={strategy?.recommendations.find(
            (r) => r.platformId === publishFor.platformId
          )}
          defaultPostIdx={publishFor.postIdx}
          lockedDraft={Boolean(publishFor.plannedExperimentId)}
          trial={
            workspace.plannedExperiments?.find(
              (item) => item.id === publishFor.plannedExperimentId
            )?.opportunity
          }
          publishedPostIndices={workspace.experiments
            .filter((item) => item.platformId === publishFor.platformId)
            .map((item) => item.postIdx)}
          initialVariable={
            workspace.plannedExperiments?.find(
              (item) => item.id === publishFor.plannedExperimentId
            )?.variable
          }
          initialCommunity={
            workspace.plannedExperiments?.find(
              (item) => item.id === publishFor.plannedExperimentId
            )?.venue
          }
          initialAngle={
            workspace.plannedExperiments?.find(
              (item) => item.id === publishFor.plannedExperimentId
            )?.angle
          }
          heldConstant={
            workspace.plannedExperiments?.find(
              (item) => item.id === publishFor.plannedExperimentId
            )?.heldConstant
          }
          sourceExperiment={workspace.experiments.find(
            (item) =>
              item.id ===
              workspace.plannedExperiments?.find(
                (plan) => plan.id === publishFor.plannedExperimentId
              )?.sourceExperimentId
          )}
          demo={demo}
          onConfirm={confirmPublish}
          onClose={() => {
            setPublishFor(null);
            setPendingPublish(undefined);
          }}
        />
      )}
    </div>
  );
}
