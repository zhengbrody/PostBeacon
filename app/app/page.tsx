"use client";

import Link from "next/link";
import { useLaunchFlow } from "@/hooks/useLaunchFlow";
import { Stepper } from "@/components/app/Stepper";
import { UrlStep } from "@/components/app/UrlStep";
import { ProfileForm } from "@/components/app/ProfileForm";
import { StrategyView } from "@/components/app/StrategyView";
import { ResultsView } from "@/components/app/ResultsView";
import { ProjectBar } from "@/components/app/ProjectBar";
import { Spinner } from "@/components/ui/Spinner";

export default function AppPage() {
  const f = useLaunchFlow();

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <Link href="/" className="text-xl font-bold tracking-tight">
          Post<span className="text-accent-400">Beacon</span>
        </Link>
        <ProjectBar snapshot={f.snapshot} onLoad={f.loadProject} />
      </header>

      <Stepper step={f.step} />

      {f.availProviders.length === 0 && (
        <div className="mb-6 rounded-md bg-amber-950/60 px-4 py-3 text-xs text-amber-300">
          No model API key detected. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to
          .env, then restart.
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
          onAnalyze={f.analyze}
        />
      )}

      {f.step === "profile" && f.profile && (
        <ProfileForm
          profile={f.profile}
          setProfile={f.setProfile}
          loading={f.loading}
          onBack={f.reset}
          onNext={f.buildStrategy}
        />
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
          posted={f.posted}
          onTogglePosted={f.togglePosted}
          onReset={f.reset}
        />
      )}
    </main>
  );
}
