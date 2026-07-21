"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLaunchFlow, type Step } from "@/hooks/useLaunchFlow";
import { useAutosave } from "@/hooks/useAutosave";
import { Stepper } from "@/components/app/Stepper";
import { UrlStep } from "@/components/app/UrlStep";
import { ProfileForm } from "@/components/app/ProfileForm";
import { FactLedger } from "@/components/app/FactLedger";
import { LaunchSetup } from "@/components/app/LaunchSetup";
import { StrategyView } from "@/components/app/StrategyView";
import { ResultsView } from "@/components/app/ResultsView";
import { ProjectBar } from "@/components/app/ProjectBar";
import { Paywall } from "@/components/app/Paywall";
import { UsageBadge } from "@/components/app/UsageBadge";
import { FeedbackCTA } from "@/components/app/FeedbackCTA";
import { CopilotPanel, type CopilotOpenRequest } from "@/components/app/CopilotPanel";
import { AuthScreen } from "@/components/app/AuthScreen";
import { useSupabaseUser } from "@/components/app/SignIn";
import { supabaseConfigured } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { shouldResetForAccountBoundary } from "@/lib/accountBoundary";
import {
  clearPreviewHandoff,
  consumePreviewHandoffForAuthReturn,
  shouldClearPreviewHandoff,
  type PreviewHandoff,
} from "@/lib/previewHandoff";

export default function AppPage() {
  const f = useLaunchFlow();
  const { resetAccountBoundary } = f;
  const { userId, userEmail, supabase, loading: authLoading } = useSupabaseUser();
  const { lastSaved, saveError, saving, saveNow } = useAutosave(f, {
    userId,
    supabase,
  });
  const previousUserId = useRef<string | null | undefined>(undefined);
  const [previewHandoff, setPreviewHandoff] = useState<PreviewHandoff | null>(null);
  const [handoffAccepted, setHandoffAccepted] = useState(false);
  const [handoffReadyToSave, setHandoffReadyToSave] = useState(false);

  const clearHandoffState = useCallback(() => {
    clearPreviewHandoff();
    setPreviewHandoff(null);
    setHandoffAccepted(false);
    setHandoffReadyToSave(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    const previous = previousUserId.current;
    if (shouldResetForAccountBoundary(previous, userId)) {
      resetAccountBoundary();
      // A guest handoff may cross the initial signed-out → signed-in redirect,
      // but it must never survive a real account switch or sign-out.
      if (shouldClearPreviewHandoff(previous, userId)) {
        clearHandoffState();
      }
    }
    previousUserId.current = userId;
  }, [authLoading, userId, resetAccountBoundary, clearHandoffState]);

  useEffect(() => {
    if (authLoading || !userId) return;
    const current = new URL(window.location.href);
    const nonce = current.searchParams.get("preview_handoff");
    if (!nonce) return;
    setPreviewHandoff(consumePreviewHandoffForAuthReturn(nonce));
    current.searchParams.delete("preview_handoff");
    window.history.replaceState(
      {},
      "",
      `${current.pathname}${current.search}${current.hash}`
    );
  }, [authLoading, userId]);

  useEffect(() => {
    if (!handoffReadyToSave || !handoffAccepted || !previewHandoff || !f.profile) return;
    setHandoffReadyToSave(false);
    void saveNow().then((saved) => {
      // Clear only after the authenticated project write succeeds. A failed
      // save keeps the browser handoff available for retry/recovery.
      if (saved) clearHandoffState();
    });
  }, [
    handoffReadyToSave,
    handoffAccepted,
    previewHandoff,
    f.profile,
    saveNow,
    clearHandoffState,
  ]);

  // Login gate: required only when Supabase is configured. The demo bypasses it
  // so anyone can explore the example; with no Supabase keys the app stays open.
  const gateOn = supabaseConfigured() && !f.demo;
  const checkingAuth = gateOn && authLoading;
  const needsAuth = gateOn && !authLoading && !userEmail;
  const showHeaderTools = !checkingAuth && !needsAuth && !f.demo;

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xl font-bold tracking-tight">
            Post<span className="text-accent-400">Beacon</span>
          </Link>
          {showHeaderTools && <UsageBadge refreshKey={f.generations} />}
        </div>
        {showHeaderTools && (
          <ProjectBar
            snapshot={f.snapshot}
            onLoad={f.loadProject}
            lastSaved={lastSaved}
            saveError={saveError}
            saving={saving}
            onSaveNow={async () => {
              const saved = await saveNow();
              if (saved && handoffAccepted && previewHandoff && f.profile) {
                clearHandoffState();
              }
              return saved;
            }}
          />
        )}
      </header>

      {checkingAuth ? (
        <div className="mt-16 flex justify-center text-accent-300">
          <Spinner />
        </div>
      ) : needsAuth ? (
        <AuthScreen onDemo={f.loadDemo} />
      ) : (
        <AppFlow
          f={f}
          canReceiveEmail={Boolean(userEmail)}
          previewHandoff={previewHandoff}
          handoffAccepted={handoffAccepted}
          onAcceptHandoff={() => {
            if (!previewHandoff) return;
            f.reset();
            f.setUrl(previewHandoff.url);
            setHandoffAccepted(true);
          }}
          onHandoffAnalyzed={() => setHandoffReadyToSave(true)}
          onClearHandoff={clearHandoffState}
        />
      )}
    </main>
  );
}

function AppFlow({
  f,
  canReceiveEmail,
  previewHandoff,
  handoffAccepted,
  onAcceptHandoff,
  onHandoffAnalyzed,
  onClearHandoff,
}: {
  f: ReturnType<typeof useLaunchFlow>;
  canReceiveEmail: boolean;
  previewHandoff: PreviewHandoff | null;
  handoffAccepted: boolean;
  onAcceptHandoff: () => void;
  onHandoffAnalyzed: () => void;
  onClearHandoff: () => void;
}) {
  const [copilotOpenRequest, setCopilotOpenRequest] = useState<CopilotOpenRequest | null>(
    null
  );
  const copilotRequestId = useRef(0);
  const openCopilot = (prompt: string, targetPlatformId?: string) => {
    copilotRequestId.current += 1;
    setCopilotOpenRequest({ id: copilotRequestId.current, prompt, targetPlatformId });
  };
  const reachable: Step[] = ["input"];
  if (f.profile) reachable.push("profile");
  if (f.strategy) reachable.push("strategy");
  if (f.result) reachable.push("results");

  return (
    <>
      <Stepper step={f.step} enabled={reachable} onNavigate={f.setStep} />

      {previewHandoff && f.step === "input" && !f.demo && (
        <div className="no-print mb-6 rounded-xl border border-accent-700/50 bg-accent-950/20 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-300">
                Guest preview ready
              </p>
              <h2 className="mt-1 font-semibold text-neutral-100">
                {previewHandoff.preview.product.name} ·{" "}
                {previewHandoff.preview.channel.platformName}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-neutral-400">
                {handoffAccepted
                  ? "The URL is restored below. Run the signed-in analysis to verify the full fact ledger and build a saved project."
                  : "This browser kept the one-channel result for the sign-in handoff. Nothing is imported or assigned to this account until you choose to continue."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!handoffAccepted && (
                <Button size="sm" onClick={onAcceptHandoff}>
                  Continue with this URL
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={onClearHandoff}>
                Discard preview
              </Button>
            </div>
          </div>
        </div>
      )}

      {f.step === "input" && f.pendingDraft && !f.demo && (
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-4 py-3 text-xs">
          <span className="text-neutral-300">
            Pick up where you left off
            {f.pendingDraft.profile?.name ? ` — ${f.pendingDraft.profile.name}` : ""}?
          </span>
          <span className="flex gap-2">
            <Button size="sm" onClick={f.resumeDraft}>
              Continue
            </Button>
            <Button size="sm" variant="outline" onClick={f.clearLocalDraft}>
              Discard draft
            </Button>
          </span>
        </div>
      )}

      {f.demo && (
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent-700/50 bg-accent-600/10 px-4 py-3 text-xs text-accent-200">
          <span>
            <span className="font-semibold">Fictional example · never saved.</span> This
            walkthrough makes no model calls and never posts anything.
          </span>
          <Button size="sm" variant="outline" onClick={f.reset}>
            Try your own URL →
          </Button>
        </div>
      )}

      {f.availProviders.length === 0 && !f.demo && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md bg-amber-950/60 px-4 py-3 text-xs text-amber-300">
          <span>
            No model API key detected. Add ANTHROPIC_API_KEY, OPENAI_API_KEY, or
            DEEPSEEK_API_KEY to .env and restart — or explore the example plan.
          </span>
          <Button size="sm" variant="outline" onClick={f.loadDemo}>
            See an example →
          </Button>
        </div>
      )}

      {f.error && (
        <div className="mb-6 rounded-md bg-red-950/60 px-4 py-3 text-sm text-red-300">
          {f.error}
        </div>
      )}

      {f.loading && (
        <div className="mb-6 flex items-center gap-3 rounded-md bg-accent-600/15 px-4 py-3 text-sm text-accent-200">
          <Spinner />
          {f.loadingMsg}
        </div>
      )}

      {f.step === "input" && (
        <UrlStep
          url={f.url}
          setUrl={f.setUrl}
          provider={f.provider}
          setProvider={f.setProvider}
          availProviders={f.availProviders}
          loading={f.loading}
          onAnalyze={() => {
            void f.analyze().then((succeeded) => {
              if (succeeded && handoffAccepted) onHandoffAnalyzed();
            });
          }}
          onDemo={f.loadDemo}
        />
      )}

      {f.step === "profile" && f.profile && (
        <div className="space-y-6">
          <FactLedger
            facts={f.facts}
            // The growth goal has one home in LaunchSetup below. Keeping the
            // same question in two adjacent cards made the intake feel broken.
            questions={f.questions.filter((question) => question.id !== "conversionGoal")}
            onConfirm={f.confirmFact}
            onCorrect={f.correctFact}
            onDelete={f.deleteFact}
            onAnswer={f.answerQuestion}
          />
          <LaunchSetup
            launchDate={f.launchDate}
            setLaunchDate={f.setLaunchDate}
            weeklyMinutes={f.workspace.weeklyMinutes}
            setWeeklyMinutes={f.setWeeklyMinutes}
            primaryGoal={f.profile.conversionGoal}
            stage={f.profile.stage}
            setPrimaryGoal={(goal) => f.answerQuestion("conversionGoal", goal)}
            publisherVoice={f.profile.publisherVoice}
            setPublisherVoice={(publisherVoice) => {
              const profile = f.profile;
              if (profile) f.setProfile({ ...profile, publisherVoice });
            }}
          />
          <ProfileForm
            profile={f.profile}
            setProfile={f.setProfile}
            loading={f.loading}
            onBack={f.reset}
            onNext={f.buildStrategy}
          />
        </div>
      )}

      {f.step === "strategy" && f.strategy && (
        <StrategyView
          strategy={f.strategy}
          selected={f.selected}
          onToggle={f.toggleSelected}
          loading={f.loading}
          onBack={() => f.setStep("profile")}
          onGenerate={f.generate}
        />
      )}

      {f.step === "results" && f.result && (
        <ResultsView
          result={f.result}
          strategy={f.strategy}
          profile={f.profile}
          facts={f.facts}
          workspace={f.workspace}
          memory={f.memory}
          posted={f.posted}
          onTogglePosted={f.togglePosted}
          onRegenerate={f.regeneratePost}
          onUpdatePost={f.updatePost}
          onUpdateStrategy={f.updateStrategy}
          onUpdateRecommendation={f.updateRecommendation}
          onUpdateScheduleItem={f.updateScheduleItem}
          onRemoveScheduleItem={f.removeScheduleItem}
          onAddScheduleItem={f.addScheduleItem}
          onRemoveChannel={f.removeChannel}
          onAddChannel={f.addChannel}
          onRetryFailed={f.retryFailed}
          onActTask={f.actTask}
          onPublishExperiment={f.publishExperiment}
          onRecordOutcome={f.recordOutcome}
          onStopExperiment={f.stopExperiment}
          onGenerateVariant={f.generateVariant}
          launchDate={f.launchDate}
          setLaunchDate={f.setLaunchDate}
          loading={f.loading}
          demo={f.demo}
          onReset={f.reset}
          onAskCopilot={openCopilot}
          emailRemindersAvailable={
            canReceiveEmail && process.env.NEXT_PUBLIC_EMAIL_REMINDERS_ENABLED === "true"
          }
          onToggleEmailReminders={f.setEmailReminders}
        />
      )}

      {f.step === "results" && f.result && (
        <div className="mt-8">
          <FeedbackCTA />
        </div>
      )}

      {f.step === "results" && f.result && f.profile && f.strategy && !f.demo && (
        <CopilotPanel
          profile={f.profile}
          strategy={f.strategy}
          result={f.result}
          facts={f.facts}
          workspace={f.workspace}
          memory={f.memory}
          launchDate={f.launchDate}
          provider={f.provider}
          loading={f.loading}
          onAuthRequired={() => f.setPaywall("auth")}
          applyAction={f.applyAction}
          rejectAction={f.rejectAction}
          auditBlocked={f.auditBlocked}
          setTone={f.setTone}
          addBannedClaim={f.addBannedClaim}
          removeBannedClaim={f.removeBannedClaim}
          publishExperiment={f.publishExperiment}
          recordOutcome={f.recordOutcome}
          stopExperiment={f.stopExperiment}
          generateVariant={f.generateVariant}
          onProviderFallback={f.setProvider}
          openRequest={copilotOpenRequest}
        />
      )}

      {f.paywall && <Paywall reason={f.paywall} onClose={() => f.setPaywall(null)} />}
    </>
  );
}
